const keys = require('./keys.js');
const representatives = require('./representatives.js');
const { 
    capitalizeFirstWordInString,
    delay,
    isLastDayOfMonth,
    isObjectEmpty,
    sortObjectPropertiesByValue,
} = require('./helpers.js');
const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const { TwitterApi } = require('twitter-api-v2');
const argv = require('minimist')(process.argv.slice(2));
const turf = require('@turf/turf');
const assert = require('node:assert/strict');

const assetDirectory = `./assets-${argv.location}`;
const summaryFile = `./summary-${argv.location}.json`;

const lf = new Intl.ListFormat('en');

const disclaimerTweet = 'Disclaimer: This bot only tweets incidents called into 911, and this data is not representative of all crashes that may have occurred.';

const districtsWithMostCrashes = (obj) => {
    const sorted = sortObjectPropertiesByValue(obj);

    return sorted.filter(district => district[1] === sorted[0][1]);
};

/**
 * Makes a GET request to Citizen to fetch 200 recent incidents. Using 200 because I think that
 * shgould be a high enough limit to grab all incidents for a given day.
 * @returns JSON list of incidents.
 */
const fetchIncidents = async (lowerLatitude, lowerLongitude, upperLatitude, upperLongitude) => {
    const response = await axios.get(`https://citizen.com/api/incident/trending?lowerLatitude=${lowerLatitude}&lowerLongitude=${lowerLongitude}&upperLatitude=${upperLatitude}&upperLongitude=${upperLongitude}&fullResponse=true&limit=200`);

    return response.data.results;
};

/**
 * Makes a GET request to download a geojson file of City Council Districts.
 * @param {String} url url of the geojson file to download
 * @returns resolved promise.
 */
 const downloadCityCouncilPolygons = async (url) => {
    const geojsonPath = path.resolve(__dirname, `${assetDirectory}/city_council_districts.geojson`);
    const writer = fs.createWriteStream(geojsonPath);

    const response = await axios.get(url, { responseType: 'stream' });
    
    return new Promise(resolve => response.data.pipe(writer).on('finish', resolve));
};

/**
 * Makes GET requests to download map images of an incident.
 * @param {String} incident the incident to download images for
 * @param {String} eventKey the ID of the citizen incident
 * @returns resolved promise.
 */
const downloadMapImages = async (incident, eventKey, tweetSatellite, location) => {
    const citizenMapImagePath = path.resolve(__dirname, `${assetDirectory}/${eventKey}.png`);
    const citizenMapWriter = fs.createWriteStream(citizenMapImagePath);
    const citizenMapResponse = await axios.get(incident.shareMap, { responseType: 'stream' });

    if (tweetSatellite && keys[location].googleKey) {
        const googleSatelliteImagePath = path.resolve(__dirname, `${assetDirectory}/${eventKey}_satellite.png`);
        const googleSatelliteWriter = fs.createWriteStream(googleSatelliteImagePath);
        const googleSatelliteResponse = await axios({
            url: `https://maps.googleapis.com/maps/api/staticmap?center=${incident.latitude},${incident.longitude}&size=500x500&zoom=20&maptype=hybrid&scale=2&key=${keys[location].googleKey}`,
            method: 'GET',
            responseType: 'stream',
        });

        return Promise.all([
            new Promise(resolve => citizenMapResponse.data.pipe(citizenMapWriter).on('finish', resolve)),
            new Promise(resolve => googleSatelliteResponse.data.pipe(googleSatelliteWriter).on('finish', resolve)),
        ]);
    }
    
    return new Promise(resolve => citizenMapResponse.data.pipe(citizenMapWriter).on('finish', resolve));
};

const mapCoordinateToCityCouncilDistrict = (coordinate, cityCouncilFeatures) => {
    for (let i = 0; i < cityCouncilFeatures.length; i++) {
        if (turf.booleanPointInPolygon(coordinate, cityCouncilFeatures[i])) {
            return cityCouncilFeatures[i].properties.NAME;
        }
    }

    return null;
};

const mapIncidentsToCityCouncilDistricts = (incidents) => {
    const cityCouncilFeatureCollection = turf.featureCollection(
            JSON.parse(fs.readFileSync(`${assetDirectory}/city_council_districts.geojson`))
        ).features.features;

    return incidents.map(x => {
        return {
            ...x,
            cityCouncilDistrict: mapCoordinateToCityCouncilDistrict(
                    turf.point([x.longitude, x.latitude]), 
                    cityCouncilFeatureCollection
                ),
        }
    });
};

/**
 * Deletes asset folder from disk, and then re-creates it.
 */
const resetAssetsFolder = () => {
    fs.removeSync(assetDirectory);
    fs.ensureDirSync(assetDirectory);
};

/**
 * Tweets thread on a Citizen incident that includes a Pedestrian or Bicyclist
 * @param {*} client the instantiated Twitter client
 * @param {*} incident the Citizen incident to tweet
 */
const tweetIncidentThread = async (client, incident, dryRun, tweetReps, tweetSatellite, location) => {
    const incidentDate = new Date(incident.ts).toLocaleString('en-US', { timeZone: keys[location].timeZone});
    const tweets = [];
    const media_ids = [];

    if (!dryRun) {
        // Upload map images and add alt text
        const citizenMapMediaId = await client.v1.uploadMedia(`${assetDirectory}/${incident.key}.png`);
        await client.v1.createMediaMetadata(citizenMapMediaId, { alt_text: { text: `A photo of a map at ${incident.address}. Coordinates: ${incident.latitude}, ${incident.longitude}` } });
        media_ids.push(citizenMapMediaId);
    }

    if (tweetSatellite && !dryRun) {
        const satelliteMapMediaId = await client.v1.uploadMedia(`${assetDirectory}/${incident.key}_satellite.png`);
        await client.v1.createMediaMetadata(satelliteMapMediaId, { alt_text: { text: `A satellite photo of a map at ${incident.address}. Coordinates: ${incident.latitude}, ${incident.longitude}` } });
        media_ids.push(satelliteMapMediaId);
    }

    // Add initial tweet with map image linked
    tweets.push({ text: `${incident.raw}\n\n${incidentDate}`, media: { media_ids }})


    for (const updateKey in incident.updates) {
        if (incident.updates[updateKey].type != 'ROOT') {
            const updateTime = new Date(incident.updates[updateKey].ts).toLocaleString('en-US', { timeZone: keys[location].timeZone});
            tweets.push(`${incident.updates[updateKey].text}\n\n${updateTime}`)
        }
    }

    if (tweetReps && representatives[location][incident.cityCouncilDistrict] && incident.cityCouncilDistrict) {
        const representative = representatives[location][incident.cityCouncilDistrict];
        tweets.push(`This incident occurred in ${representatives[location].repesentativeDistrictTerm} ${incident.cityCouncilDistrict}. \n\nRepresentative: ${representative}`)
    }

    tweetThread(client, tweets, dryRun);
};

/**
 * Tweets number of relevant Citizen incidents over the last 24 hours.
 * @param {*} client the instantiated Twitter client
 * @param {*} incidents the relevant Citizen incidents
 */
const tweetSummaryOfLast24Hours = async (client, incidents, tweetReps, location, dryRun) => {
    const numIncidents = incidents.length;
    let firstTweet = numIncidents === 1 ? `There was ${numIncidents} Bicyclist and Pedestrian related crash found over the last 24 hours.` : `There were ${numIncidents} Bicyclist and Pedestrian related crashes found over the last 24 hours.`;
    const tweets = [firstTweet, disclaimerTweet];

    if (numIncidents > 0 && tweetReps) {
        if (tweetReps) {
            const districts = [...new Set(incidents.map(x => x.cityCouncilDistrict))].sort();
            const districtSentenceStart = numIncidents === 1 ? 'The crash occurred in' : 'The crashes occurred in';
            const districtSentenceEnd = districts.length === 1 ? `${representatives[location].repesentativeDistrictTerm} ${lf.format(districts)}` : `${representatives[location].repesentativeDistrictTerm}s ${lf.format(districts)}`;
            
            tweets[0] = `${firstTweet}\n\n${districtSentenceStart} ${districtSentenceEnd}.`;
        }

        if (tweetReps && representatives[location].atLarge) {
            const atLargeRepInfo = representatives[location].atLarge;
            tweets.push(`At large city council representatives and president: ${lf.format(atLargeRepInfo)}`);
        }
    }

    tweetThread(client, tweets, dryRun);
};

/**
 * Filters Citizen incidents and returns ones involving Pedestrian and Bicyclists.
 * @param {Array} allIncidents an array of Citizen incidents
 * @returns an array of Citizen incidents mentioning Pedestrians or Bicyclists.
 */
const filterIncidents = (allIncidents) => {
    const yesterdayTimestampInMs = Date.now() - 86400000;

    // Get incidents from the last 24 hours with pedestrian or bicyclist in the top level description
    const relevantIncidents = allIncidents
        .filter(x => x.ts >= yesterdayTimestampInMs)
        .filter(x => 
            !x.raw.toLowerCase().includes("robbed") &&
            !x.raw.toLowerCase().includes("burglary") &&
            !x.title.toLowerCase().includes("robbed") &&
            !x.title.toLowerCase().includes("burglary")
        )
        .filter(x => 
            x.raw.toLowerCase().includes("pedestrian") ||
            x.raw.toLowerCase().includes("bicyclist") ||
            x.raw.toLowerCase().includes("struck by vehicle") ||
            x.raw.toLowerCase().includes("bicycle") ||
            x.raw.toLowerCase().includes("scooter") ||
            x.title.toLowerCase().includes("pedestrian") ||
            x.title.toLowerCase().includes("bicyclist") ||
            x.title.toLowerCase().includes("struck by vehicle") ||
            x.title.toLowerCase().includes("bicycle") ||
            x.title.toLowerCase().includes("scooter")
        )
        .filter(x => {
            // Specifically handle fire hydrants. 
            // Sometimes drivers will hit both a hydrant and a pedestrian: https://twitter.com/PedCrashCincy/status/1547222336377704451?s=20&t=7Ul5acOZibIxmw_m9RXxqg
            // Sometimes they'll only hit a hydrant: https://twitter.com/PedCrashCincy/status/1550121472286285824?s=20&t=7Ul5acOZibIxmw_m9RXxqg
            // We want to handle hydrants only if non-drivers are also involved, and ignore if not.
            if (x.raw.toLowerCase().includes("hydrant") || x.title.toLowerCase().includes("hydrant")) {
                if (
                    x.raw.toLowerCase().includes("pedestrian") || x.title.toLowerCase().includes("pedestrian") ||
                    x.raw.toLowerCase().includes("bicyclist") || x.title.toLowerCase().includes("bicyclist") ||
                    x.raw.toLowerCase().includes("bicycle") || x.title.toLowerCase().includes("bicycle") ||
                    x.raw.toLowerCase().includes("scooter") || x.title.toLowerCase().includes("scooter")
                ) {
                    return true
                } else {
                    return false;
                }
            }

            return true;
        });

    // Get incidents from the last 24 hours with pedestrian or bicyuclist in an update
    // It's possible an incident could have a description that doesn't involve a pedestrian
    // or bicyclist but in a 911 update Citizen later learns they were involved
    const incidentsWithRelevantUpdates = allIncidents
        .filter(x => x.ts >= yesterdayTimestampInMs)
        .filter(x => {
            for (const updateObjectKey in x.updates) {
                const updateText = x.updates[updateObjectKey].text.toLowerCase()
                if (
                    updateText.includes("robbed") ||
                    updateText.includes("burglary") ||
                    updateText.includes("breaking into")
                ) {
                    return false
                }
                else if (
                    updateText.includes("pedestrian") || 
                    updateText.includes("bicyclist") || 
                    updateText.includes("struck by vehicle") || 
                    updateText.includes("bicycle") ||
                    updateText.includes("scooter")
                ) {
                    return true
                }
            }
            return false
        });

    return Array.from(new Set([...relevantIncidents, ...incidentsWithRelevantUpdates]));
};

const validateInputs = (location, tweetSatellite, tweetReps) => {
    assert.notEqual(location, undefined, 'location must be passed in');
    assert.notEqual(keys[location], undefined, 'keys file must have location information');
    
    if (tweetSatellite) {
        assert.notEqual(keys[location].googleKey, undefined, 'keys file must contain googleKey for location if calling with tweetSatellite flag');
    }

    if (tweetReps) {
        assert.notEqual(representatives[location], undefined, 'must have representative info for location if calling with tweetReps flag');
        assert.notEqual(representatives[location].geojsonUrl, undefined, 'must have geojsonUrl set so incidents can be mapped to representative districts if calling with tweetReps flag');
        assert.notEqual(representatives[location].repesentativeDistrictTerm, undefined, 'must have repesentativeDistrictTerm set if calling with tweetReps flag');
    }
};

const tweetThread = async (client, tweets, dryRun) => {
    if (dryRun) {
        console.log(tweets)
    } else {
        await client.v2.tweetThread(tweets);
    }
};

const handleSummary = async (client, incidents, summary, tweetReps, dryRun, location) => {
    await fs.ensureFileSync(summaryFile);

    const tweets = [];
    const summaryString = await fs.readFileSync(summaryFile, "utf8");
    let summaryObj;
    let innerInitialSummary = {
        total: 0,
    };

    if (summary === 'districts') {
        innerInitialSummary = {
            ...innerInitialSummary,
            districts: {},
        }
    }

    if (summaryString.length === 0) {
        summaryObj = {
            week: innerInitialSummary,
            month: innerInitialSummary,
        };
    } else {
        summaryObj = JSON.parse(summaryString);
    }

    summaryObj.week.total += incidents.length
    summaryObj.month.total += incidents.length

    if (summary === 'districts') {
        for (const incident of incidents) {
            if (tweetReps && incident.cityCouncilDistrict) {
                if (summaryObj.week.districts[incident.cityCouncilDistrict]) {
                    summaryObj.week.districts[incident.cityCouncilDistrict] += 1;
                } else {
                    summaryObj.week.districts[incident.cityCouncilDistrict] = 1;
                }

                if (summaryObj.month.districts[incident.cityCouncilDistrict]) {
                    summaryObj.month.districts[incident.cityCouncilDistrict] += 1;
                } else {
                    summaryObj.month.districts[incident.cityCouncilDistrict] = 1;
                }
            }
        }
    }

    const today = new Date();

    if (today.getDay() === 6) {
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - 6);

        // Last day of the week
        const summaryTweet = summaryObj.week.total !== 1 ? `There were ${summaryObj.week.total} crashes reported by this bot citywide during the week of ${startOfWeek.getMonth() + 1}/${startOfWeek.getDate()}.` : `There was ${summaryObj.week.total} crash reported by this bot citywide during the week of ${startOfWeek.getMonth() + 1}/${startOfWeek.getDate()}.`;
        tweets.push("Weekly summary");
        tweets.push(summaryTweet);

        if (summary === 'districts' && summaryObj.week.districts && !isObjectEmpty(summaryObj.week.districts)) {
            let districts = districtsWithMostCrashes(summaryObj.week.districts);
            let districtNames = districts.map(district => district[0]);

            const districtTweet = districtNames.length !== 1 ? `${capitalizeFirstWordInString(representatives[location].repesentativeDistrictTerm)}s ${lf.format(districtNames)} had a total of ${districts[0][1]} crashes reported this week, which are the highest of all ${representatives[location].repesentativeDistrictTerm}s.` : `${capitalizeFirstWordInString(representatives[location].repesentativeDistrictTerm)} ${lf.format(districtNames)} had a total of ${districts[0][1]} crashes reported this week, which is the highest of all ${representatives[location].repesentativeDistrictTerm}s.`;

            tweets.push(districtTweet);
        }

        summaryObj.week = innerInitialSummary;
    }

    if (isLastDayOfMonth(today)) {
        // Last day of month
        const monthName = today.toLocaleString('default', { month: 'long' });
        const summaryTweet = summaryObj.month.total !== 1 ? `There were ${summaryObj.month.total} crashes reported by this bot citywide during ${monthName}.` : `There was ${summaryObj.month.total} crash reported by this bot citywide during ${monthName}.`
        tweets.push("Monthly summary");
        tweets.push(summaryTweet);

        if (summary === 'districts' && summaryObj.month.districts && !isObjectEmpty(summaryObj.month.districts)) {
            let districts = districtsWithMostCrashes(summaryObj.month.districts);
            let districtNames = districts.map(district => district[0]);

            const districtTweet = districtNames.length !== 1 ? `${capitalizeFirstWordInString(representatives[location].repesentativeDistrictTerm)}s ${lf.format(districtNames)} had a total of ${districts[0][1]} crashes reported during ${monthName}, which are the highest of all ${representatives[location].repesentativeDistrictTerm}s.` : `${capitalizeFirstWordInString(representatives[location].repesentativeDistrictTerm)} ${lf.format(districtNames)} had a total of ${districts[0][1]} crashes reported during ${monthName}, which is the highest of all ${representatives[location].repesentativeDistrictTerm}s.`;

            tweets.push(districtTweet);
        }

        summaryObj.month = innerInitialSummary;
    }

    if (tweets.length > 0) {
        tweets.push(disclaimerTweet);
        
        tweetThread(client, tweets, dryRun);
    }

    await fs.writeFileSync(summaryFile, JSON.stringify(summaryObj));
};

const main = async () => {
    const delayTime = argv.dryRun ? 1000 : 60000;

    validateInputs(argv.location, argv.tweetSatellite, argv.tweetReps);

    const client = new TwitterApi({
        appKey: keys[argv.location].consumer_key,
        appSecret: keys[argv.location].consumer_secret,
        accessToken: keys[argv.location].access_token,
        accessSecret: keys[argv.location].access_token_secret,
    });

    resetAssetsFolder();

    const allIncidents = await fetchIncidents(
        keys[argv.location].lowerLatitude,
        keys[argv.location].lowerLongitude,
        keys[argv.location].upperLatitude,
        keys[argv.location].upperLongitude,
    );
    let filteredIncidents = filterIncidents(allIncidents);

    if (argv.tweetReps) {
        await downloadCityCouncilPolygons(representatives[argv.location].geojsonUrl);
        filteredIncidents = mapIncidentsToCityCouncilDistricts(filteredIncidents);
    }

    await tweetSummaryOfLast24Hours(client, filteredIncidents, argv.tweetReps, argv.location, argv.dryRun);

    for (const incident of filteredIncidents) {
        // wait one minute to prevent rate limiting
        await delay(delayTime);

        await downloadMapImages(incident, incident.key, argv.tweetSatellite, argv.location);

        await tweetIncidentThread(client, incident, argv.dryRun, argv.tweetReps, argv.tweetSatellite, argv.location);
    }

    if (argv.summary) {
        await delay(delayTime);
        handleSummary(client, filteredIncidents, argv.summary, argv.tweetReps, argv.dryRun, argv.location);
    }
};

main();
