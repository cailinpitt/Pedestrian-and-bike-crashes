const keys = require('./keys.js');
const representatives = require('./representatives.js');
const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const { TwitterApi } = require('twitter-api-v2');
const argv = require('minimist')(process.argv.slice(2));
const turf = require('@turf/turf');
const assert = require('node:assert/strict');

const testData = require('./richmond.json');

const assetDirectory = `./assets-${argv.location}`;


/**
 * Temporarily halts program execution.
 * @param {Number} ms number of miliseconds to wait
 * @returns promise
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Makes a GET request to Citizen to fetch 200 recent incidents. Using 200 because I think that
 * shgould be a high enough limit to grab all incidents for a given day.
 * @returns JSON list of incidents.
 */
const fetchIncidents = async () => {
  const location = keys[argv.location];
  const limit = 200; // 200 was not high enough for NYC data
  // https://citizen.com/api/incident/trending?lowerLatitude=37.425128&lowerLongitude=-77.669312&upperLatitude=37.716030&upperLongitude=-77.284938&fullResponse=true&limit=200
  const citizenUrl = `https://citizen.com/api/incident/trending?lowerLatitude=${location.lowerLatitude}&lowerLongitude=${location.lowerLongitude}&upperLatitude=${location.upperLatitude}&upperLongitude=${location.upperLongitude}&fullResponse=true&limit=${limit}`;
  const response = await axios({
    url: citizenUrl,
    method: 'GET',
  });

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

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  return new Promise(resolve => response.data.pipe(writer).on('finish', resolve));
};

/**
 * Makes GET requests to download map images of an incident.
 * @param {String} incident the incident to download images for
 * @param {String} eventKey the ID of the citizen incident
 * @returns resolved promise.
 */
const downloadMapImages = async (incident, eventKey) => {
  const citizenMapImagePath = path.resolve(__dirname, `${assetDirectory}/${eventKey}.png`);
  const citizenMapWriter = fs.createWriteStream(citizenMapImagePath);
  const citizenMapResponse = await axios({
    url: incident.shareMap,
    method: 'GET',
    responseType: 'stream',
  });

  if (argv.tweetSatellite && keys[argv.location].googleKey) {
    const googleSatelliteImagePath = path.resolve(__dirname, `${assetDirectory}/${eventKey}_satellite.png`);
    const googleSatelliteWriter = fs.createWriteStream(googleSatelliteImagePath);
    const googleSatUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${incident.latitude},${incident.longitude}&size=500x500&zoom=20&maptype=hybrid&scale=2&key=${keys[argv.location].googleKey}`;
    const googleSatelliteResponse = await axios({
      url: googleSatUrl,
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
    };
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
const tweetIncidentThread = async (client, incident) => {
  const incidentDate = new Date(incident.ts).toLocaleString('en-US', { timeZone: keys[argv.location].timeZone });
  const tweets = [];
  const media_ids = [];

  // Upload map images and add alt text
  const citizenMapMediaId = await client.v1.uploadMedia(`${assetDirectory}/${incident.key}.png`);
  const metadata = await client.v1.createMediaMetadata(citizenMapMediaId, { alt_text: { text: `A photo of a map at ${incident.address}. Coordinates: ${incident.latitude}, ${incident.longitude}` } });
  media_ids.push(citizenMapMediaId);

  if (argv.tweetSatellite) {
    const satelliteMapMediaId = await client.v1.uploadMedia(`${assetDirectory}/${incident.key}_satellite.png`);
    await client.v1.createMediaMetadata(satelliteMapMediaId, { alt_text: { text: `A satellite photo of a map at ${incident.address}. Coordinates: ${incident.latitude}, ${incident.longitude}` } });
    media_ids.push(satelliteMapMediaId);
  }

  // Add initial tweet with map image linked
  tweets.push({ text: `${incident.raw}\n\n${incidentDate}`, media: { media_ids } });

  for (const updateKey in incident.updates) {
    if (incident.updates[updateKey].type != 'ROOT') {
      const updateTime = new Date(incident.updates[updateKey].ts).toLocaleString('en-US', { timeZone: keys[argv.location].timeZone });
      tweets.push(`${incident.updates[updateKey].text}\n\n${updateTime}`);
    }
  }

  if (argv.tweetReps && representatives[argv.location][incident.cityCouncilDistrict] && incident.cityCouncilDistrict) {
    const representative = representatives[argv.location][incident.cityCouncilDistrict];
    tweets.push(`This incident occurred in ${representatives[argv.location].repesentativeDistrictTerm} ${incident.cityCouncilDistrict}. \n\nRepresentative: ${representative}`);
  }

  try {
    await client.v2.tweetThread(tweets);
  } catch (err) {
    console.log('error on tweetIncidentThread: ', err);
  }
};

/**
 * Tweets number of relevant Citizen incidents over the last 24 hours.
 * @param {*} client the instantiated Twitter client
 * @param {*} incidents the relevant Citizen incidents
 */
const tweetSummaryOfLast24Hours = async (client, incidents, numPedIncidents) => {
  const lf = new Intl.ListFormat('en');
  const numIncidents = incidents.length;
  let firstTweet = numIncidents > 0
    ? `There ${numIncidents === 1 ? 'was' : 'were'} ${numIncidents} incident${numIncidents === 1 ? '' : 's'} of traffic violence found over the last 24 hours. Of these, ${numPedIncidents} involved pedestrians or cyclists.`
    : `There were no incidents of traffic violence reported to 911 today in the RVA area.`;
  const disclaimerTweet = `Disclaimer: This bot tweets incidents called into 911 and is not representative of all traffic violence that occurred.`;
  const tweets = [firstTweet];
  if (numIncidents > 0) {
    tweets.push(disclaimerTweet);
  }

  if (numIncidents > 0 && argv.tweetReps) {
    if (argv.tweetReps) {
      const districts = [...new Set(incidents.map(x => x.cityCouncilDistrict))].sort();
      const districtSentenceStart = numIncidents === 1 ? 'The crash occurred in' : 'The crashes occurred in';
      const districtSentenceEnd = districts.length === 1 ? `${representatives[argv.location].repesentativeDistrictTerm} ${lf.format(districts)}` : `${representatives[argv.location].repesentativeDistrictTerm}s ${lf.format(districts)}`;

      tweets[0] = `${firstTweet}\n\n${districtSentenceStart} ${districtSentenceEnd}.`;
    }

    if (argv.tweetReps && representatives[argv.location].atLarge) {
      const atLargeRepInfo = representatives[argv.location].atLarge;
      tweets.push(`At large city council representatives and president: ${lf.format(atLargeRepInfo)}`);
    }
  }

  try {
    await client.v2.tweetThread(tweets);
  } catch (err) {
    console.log('error on tweetSummaryOfLast24Hours: ', err);
  }

};

/**
 * Filters Citizen incidents and returns ones involving Pedestrian and Bicyclists.
 * @param {Array} allIncidents an array of Citizen incidents
 * @returns an array of Citizen incidents mentioning Pedestrians or Bicyclists.
 */
const filterPedBikeIncidents = (allIncidents) => {
  // Get incidents from the last 24 hours with pedestrian or bicyclist in the top level description
  const relevantIncidents = excludeWeaponsAndRobbery(allIncidents).filter(x =>
    x.raw.toLowerCase().includes("pedestrian") ||
    x.raw.toLowerCase().includes("cyclist") ||
    x.raw.toLowerCase().includes("struck by vehicle") ||
    x.raw.toLowerCase().includes("hit by vehicle") ||
    x.raw.toLowerCase().includes("bicycle") ||
    x.raw.toLowerCase().includes("scooter")
  );

  return relevantIncidents;
};

const excludeWeaponsAndRobbery = (array) => array.filter(x =>
  !x.raw.toLowerCase().includes("robbed") &&
  !x.raw.toLowerCase().includes("burglar") &&
  !x.raw.toLowerCase().includes("stolen") &&
  !x.raw.toLowerCase().includes("gunmen") &&
  !x.raw.toLowerCase().includes("armed") &&
  !x.raw.toLowerCase().includes("gunman")
);

const filterVehicleOnlyIncidents = (allIncidents) =>
  excludeWeaponsAndRobbery(allIncidents)
    // include vehicle collision but exclude pedestrian, bike, etc
    .filter(x =>
      x.raw.toLowerCase().includes('vehicle collision') ||
      x.raw.toLowerCase().includes('vehicle flipped') ||
      x.raw.toLowerCase().includes('overturned vehicle') ||
      x.raw.toLowerCase().includes('dragging vehicle') ||
      x.raw.toLowerCase().includes('hit-and-run')

    );

const validateInputs = () => {
  assert.notEqual(argv.location, undefined, 'location must be passed in');
  assert.notEqual(keys[argv.location], undefined, 'keys file must have location information');

  if (argv.tweetSatellite) {
    assert.notEqual(keys[argv.location].googleKey, undefined, 'keys file must contain googleKey for location if calling with tweetSatellite flag');
  }

  if (argv.tweetReps) {
    assert.notEqual(representatives[argv.location], undefined, 'must have representative info for location if calling with tweetReps flag');
    assert.notEqual(representatives[argv.location].geojsonUrl, undefined, 'must have geojsonUrl set so incidents can be mapped to representative districts if calling with tweetReps flag');
    assert.notEqual(representatives[argv.location].repesentativeDistrictTerm, undefined, 'must have repesentativeDistrictTerm set if calling with tweetReps flag');
  }
};

const handleIncidentTweets = async (client, filteredIncidents, numPedIncidents) => {

  if (argv.tweetReps) {
    await downloadCityCouncilPolygons(representatives[argv.location].geojsonUrl);
    filteredIncidents = mapIncidentsToCityCouncilDistricts(filteredIncidents);
  }

  await tweetSummaryOfLast24Hours(client, filteredIncidents, numPedIncidents);

  for (const incident of filteredIncidents) {
    console.log(incident.raw);
    // wait one minute to prevent rate limiting
    // rate limited from twitter? surely a few seconds would be enough? 
    // success on 30s, 20s, failed on 10s but seemed like it was bc of google api

    await delay(20000);
    try {
      await downloadMapImages(incident, incident.key);
    } catch (err) {
      console.log('error on downloadMapImages: ', err);
    }
    await tweetIncidentThread(client, incident);
  }
};

const main = async () => {
  validateInputs();
  const keysObj = keys[argv.location];

  const client = new TwitterApi({
    appKey: keysObj.consumer_key,
    appSecret: keysObj.consumer_secret,
    accessToken: keysObj.access_token,
    accessSecret: keysObj.access_token_secret,
  });

  resetAssetsFolder();

  // uncomment next section when using test data
  // const allIncidents = testData.results;
  // console.log('all pedbike', filterPedBikeIncidents(allIncidents).map(i => ({ raw: i.raw, time: new Date(i.ts).toLocaleString() })));
  // console.log('all vehicle', filterVehicleOnlyIncidents(allIncidents).map(i => ({ raw: i.raw, time: new Date(i.ts).toLocaleString() })));

  const allIncidents = await fetchIncidents();
  const yesterdayTimestampInMs = Date.now() - 86400000;
  const todaysIncidents = allIncidents.filter(x => x.ts >= yesterdayTimestampInMs);

  let filteredPedBikeIncidents = filterPedBikeIncidents(todaysIncidents);
  const incidentTitles = filteredPedBikeIncidents.map(x => x.title);
  const remainingIncidents = todaysIncidents.filter(x => incidentTitles.indexOf(x.title) === -1);
  let filteredVehicleOnlyIncidents = filterVehicleOnlyIncidents(remainingIncidents);

  // check to see if there were incidents today
  // console.log('allIncidents', allIncidents.length);
  // console.log([...filteredVehicleOnlyIncidents, ...filteredPedBikeIncidents].map(i => ({ raw: i.raw, time: new Date(i.ts).toLocaleString() })));

  // next line is where the magic happens
  handleIncidentTweets(client, [...filteredVehicleOnlyIncidents, ...filteredPedBikeIncidents], filteredPedBikeIncidents.length);
};

main();