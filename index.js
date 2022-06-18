const keys = require('./keys.js');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs-extra');
const { TwitterApi } = require('twitter-api-v2');
const argv = require('minimist')(process.argv.slice(2));

const assetDirectory = `./assets-${argv.location}-${uuidv4()}`;

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
    const response = await axios({
        url: `https://citizen.com/api/incident/trending?lowerLatitude=${keys[argv.location].lowerLatitude}&lowerLongitude=${keys[argv.location].lowerLongitude}&upperLatitude=${keys[argv.location].upperLatitude}&upperLongitude=${keys[argv.location].upperLongitude}&fullResponse=true&limit=200`,
        method: 'GET',
    });

    return response.data.results
};

/**
 * Makes a GET request to download a map image of an incident.
 * @param {String} url url of the image to download
 * @param {String} eventKey the ID of the citizen incident
 * @returns resolved promise.
 */
const downloadMapImage = async (url, eventKey) => {
    const imagePath = path.resolve(__dirname, `${assetDirectory}/${eventKey}.png`);
    const writer = fs.createWriteStream(imagePath);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    
    return new Promise(resolve => response.data.pipe(writer).on('finish', resolve));
};

/**
 * Deletes asset folder from disk, and then re-creates it.
 */
const resetAssetsFolder = () => {
    fs.removeSync(assetDirectory);
    fs.ensureDirSync(assetDirectory);
};

/**
 * Tweets information on a Citizen incident that includes a Pedestrian or Bicyclist
 * @param {*} client the instantiated Twitter client
 * @param {*} incident the Citizen incident to tweet
 */
const tweetIncident = async (client, incident) => {
    const incidentDate = new Date(incident.ts).toLocaleString('en-US', { timeZone: keys[argv.location].timeZone});
    const mediaId = await client.v1.uploadMedia(`${assetDirectory}/${incident.key}.png`);
    await client.v1.createMediaMetadata(mediaId, { alt_text: { text: `A photo of a map at ${incident.address}` } });
    await client.v2.tweet(`${incident.raw}\n\n${incidentDate}`, { media: { media_ids: [ mediaId ]}});
};

const main = async () => {
    if (argv.location == undefined || argv.location == null) {
        console.log("Location must be passed in (either atlanta or columbus)");
        return;
    }

    const client = new TwitterApi({
        appKey: keys[argv.location].consumer_key,
        appSecret: keys[argv.location].consumer_secret,
        accessToken: keys[argv.location].access_token,
        accessSecret: keys[argv.location].access_token_secret,
    });
    const yesterdayTimestampInMs = Date.now() - 86400000;

    resetAssetsFolder();

    const incidents = await fetchIncidents();

    const relevantIncidents = incidents
        .filter(x => 
            x.raw.toLowerCase().includes("pedestrian") ||
            x.raw.toLowerCase().includes("pedestrian") ||
            x.title.toLowerCase().includes("bicyclist") ||
            x.title.toLowerCase().includes("bicyclist")
        );
    const incidentsWithRelevantUpdates = incidents
        .filter(x => x.ts >= yesterdayTimestampInMs)
        .filter(x => {
            for (const updateObjectKey in x.updates) {
                const updateText = x.updates[updateObjectKey].text.toLowerCase()
                if (updateText.includes("pedestrian") || updateText.includes("bicyclist")) {
                    return true
                }
            }
            return false
        });
    const union = Array.from(new Set([...relevantIncidents, ...incidentsWithRelevantUpdates]));

    for (const incident of union) {
        await downloadMapImage(incident.shareMap, incident.key);

        await tweetIncident(client, incident)

        // wait one minute to prevent rate limiting
        await delay(60000);
    }
};

main();