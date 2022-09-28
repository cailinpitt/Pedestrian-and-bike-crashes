import { IncidentFull } from './types'
import { Coord } from '@turf/turf'
import { TwitterApi } from 'twitter-api-v2'

const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const argv = require('minimist')(process.argv.slice(2));
const turf = require('@turf/turf');

const keys = require('./keys.js');
const representatives = require('./representatives.js');
const { validateInputs, filterVehicleOnlyIncidents, filterPedBikeIncidents } = require('./utils/filters');
const { eliminateDuplicateIncidentsAndUpdateFile } = require('./utils/archive')

const testData = require('./archive/tweetIncidentSummaries-richmond.json');

const assetDirectory = `./assets-${argv.location}`;

const daysToTweet = argv.days ? Number(argv.days) : 1;


/**
 * Temporarily halts program execution.
 * @param {Number} ms number of miliseconds to wait
 * @returns promise
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Makes a GET request to Citizen to fetch 200 recent incidents. Using 200 because I think that
 * shgould be a high enough limit to grab all incidents for a given day.
 * @returns JSON list of incidents.
 */
const fetchIncidents = async () => {
  const location = keys[argv.location];
  const limit = 200 * daysToTweet; // 200 was not high enough for NYC data
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
const downloadCityCouncilPolygons = async (url: string) => {
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
const downloadMapImages = async (incident: IncidentFull, eventKey: string) => {
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

const mapCoordinateToCityCouncilDistrict = (coordinate: Coord, cityCouncilFeatures: any) => {
  for (let i = 0; i < cityCouncilFeatures.length; i++) {
    if (turf.booleanPointInPolygon(coordinate, cityCouncilFeatures[i])) {
      return cityCouncilFeatures[i].properties.NAME;
    }
  }

  return null;
};

const mapIncidentsToCityCouncilDistricts = (incidents: IncidentFull[]) => {
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
const tweetIncidentThread = async (client: TwitterApi, incident: IncidentFull) => {
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

  // @ts-expect-error -- no cityCouncilDistrict
  if (argv.tweetReps && representatives[argv.location][incident.cityCouncilDistrict] && incident.cityCouncilDistrict) {
    // @ts-expect-error -- no cityCouncilDistrict
    const representative = representatives[argv.location][incident.cityCouncilDistrict];
    // @ts-expect-error -- no cityCouncilDistrict
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
const tweetSummaryOfLast24Hours = async (client: TwitterApi, incidents: IncidentFull[], numPedIncidents: number) => {
  const lf = new Intl.ListFormat('en');
  const numIncidents = incidents.length;
  let firstTweet = numIncidents > 0
    ? `There ${numIncidents === 1 ? 'was' : 'were'} ${numIncidents} incident${numIncidents === 1 ? '' : 's'} of traffic violence found over the last ${daysToTweet === 1 ? '24 hours' : `${daysToTweet} days`}. Of these, ${numPedIncidents} involved pedestrians or cyclists.`
    : `There were no incidents of traffic violence reported to 911 today in the RVA area.`;
  const disclaimerTweet = `Disclaimer: This bot tweets incidents called into 911 and is not representative of all traffic violence that occurred.`;
  const tweets = [firstTweet];
  if (numIncidents > 0) {
    tweets.push(disclaimerTweet);
  }

  if (numIncidents > 0 && argv.tweetReps) {
    if (argv.tweetReps) {
      // @ts-expect-error
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

const handleIncidentTweets = async (client: TwitterApi, filteredIncidents: IncidentFull[]) => {

  if (argv.tweetReps) {
    await downloadCityCouncilPolygons(representatives[argv.location].geojsonUrl);
    filteredIncidents = mapIncidentsToCityCouncilDistricts(filteredIncidents);
  }

  for (const incident of filteredIncidents) {
    console.log(incident.raw);
    await delay(2000);
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

  const allIncidents = await fetchIncidents();
  const targetTimeInMs = Date.now() - (86400000 * daysToTweet);
  const currentIncidents = allIncidents.filter((x: IncidentFull) => x.ts >= targetTimeInMs);

  const pedBikeIncidents = filterPedBikeIncidents(currentIncidents);
  const incidentTitles = pedBikeIncidents.map((x: IncidentFull) => x.title);
  const remainingIncidents = currentIncidents.filter((x: IncidentFull) => incidentTitles.indexOf(x.title) === -1);
  const vehicleOnlyIncidents = filterVehicleOnlyIncidents(remainingIncidents);
  let incidentList = [...vehicleOnlyIncidents, pedBikeIncidents];
  // check for duplicates
  incidentList = eliminateDuplicateIncidentsAndUpdateFile(incidentList);

  await handleIncidentTweets(client, incidentList);

  // tweet the summary last because then it'll always be at the top of the timeline
  delay(5000)
  tweetSummaryOfLast24Hours(client, incidentList, pedBikeIncidents.length);
};

main();

// eliminateDuplicateIncidentsAndUpdateFile([]);
// save timestamps for when i ran it? and list of ids for incidents? then i could do the tweet summary after if it didn't go out.