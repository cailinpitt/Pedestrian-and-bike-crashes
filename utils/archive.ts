import { writeFile, readFileSync } from 'fs'
import { Incident } from '../types'
const argv = require('minimist')(process.argv.slice(2));
const keys = require('./keys.js');

const tweetIncidentSummaryFile = `../archive/tweetIncidentSummaries-${argv.location}.json`;

const saveIncidentSummaries = (array: Incident[]) => {
  writeFile(
    tweetIncidentSummaryFile,
    JSON.stringify(
      array.map(obj => ({
        key: obj.key,
        raw: obj.raw,
        ts: obj.ts,
        date: new Date(obj.ts).toLocaleString('en-US', { timeZone: keys[argv.location].timeZone }),
        ll: obj.ll,
        shareMap: obj.shareMap
      }))
    )
  , (err) => {console.log('error writing file', err)});
};

const eliminateDuplicateIncidentsAndUpdateFile = (array: Incident[]) => {
  let summaryArr: Incident[] = [];
  try {
    const summaryFile = readFileSync(tweetIncidentSummaryFile, 'utf-8');
    summaryArr = JSON.parse(summaryFile);
  } catch (err) {
    console.log(err.message);
  }
  const incidentKeys = summaryArr.map(summary => summary.key);
  const trimmedArray = array.filter(obj => incidentKeys.indexOf(obj.key) === -1);
  // this is dumb but undefined is getting in there and i'm not going to figure out why now.
  saveIncidentSummaries([...summaryArr, ...trimmedArray].filter(obj => Boolean(obj.raw)));
  return trimmedArray.filter(obj => Boolean(obj.raw));
};

module.exports = {eliminateDuplicateIncidentsAndUpdateFile, saveIncidentSummaries};