import { IncidentFull } from '../types'

const assert = require('node:assert/strict');
const argv = require('minimist')(process.argv.slice(2));

const keys = require("./keys");
const representatives = require("./representatives");

/**
 * Filters Citizen incidents and returns ones involving Pedestrian and Bicyclists.
 * @param {Array} allIncidents an array of Citizen incidents
 * @returns an array of Citizen incidents mentioning Pedestrians or Bicyclists.
 */
const filterPedBikeIncidents = (allIncidents: IncidentFull[]): IncidentFull[] =>
  excludeWeaponsAndRobbery(allIncidents)
    .filter(x =>
      x.raw.toLowerCase().includes("pedestrian") ||
      x.raw.toLowerCase().includes("cyclist") ||
      x.raw.toLowerCase().includes("struck by vehicle") ||
      x.raw.toLowerCase().includes("hit by vehicle") ||
      x.raw.toLowerCase().includes("bicycle") ||
      x.raw.toLowerCase().includes("scooter")
    );

const excludeWeaponsAndRobbery = (incidents: IncidentFull[]): IncidentFull[] =>
  incidents.filter(x =>
    !x.raw.toLowerCase().includes("robbed") &&
    !x.raw.toLowerCase().includes("burglar") &&
    !x.raw.toLowerCase().includes("stolen") &&
    !x.raw.toLowerCase().includes("gunmen") &&
    !x.raw.toLowerCase().includes("armed") &&
    !x.raw.toLowerCase().includes("gunman")
  );

const filterVehicleOnlyIncidents = (allIncidents: IncidentFull[]): IncidentFull[] =>
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

module.exports = { validateInputs, filterPedBikeIncidents, filterVehicleOnlyIncidents };