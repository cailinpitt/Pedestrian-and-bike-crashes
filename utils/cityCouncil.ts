const path = require('path')
const axios = require('axios')
const turf = require('@turf/turf')
const {Coord} = require('@turf/turf')
const {createWriteStream, readFileSync} = require('fs')
const {assetDirectory} = require('../index')
import { IncidentFull } from '../types'

/**
 * Makes a GET request to download a geojson file of City Council Districts.
 * @param {String} url url of the geojson file to download
 * @returns resolved promise.
 */
const downloadCityCouncilPolygons = async (url: string) => {
  const geojsonPath = path.resolve(__dirname, `${assetDirectory}/city_council_districts.geojson`)
  const writer = createWriteStream(geojsonPath)

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  })

  return new Promise(resolve => response.data.pipe(writer).on('finish', resolve))
}


const mapCoordinateToCityCouncilDistrict = (coordinate: typeof Coord, cityCouncilFeatures: any) => {
  for (let i = 0; i < cityCouncilFeatures.length; i++) {
    if (turf.booleanPointInPolygon(coordinate, cityCouncilFeatures[i])) {
      return cityCouncilFeatures[i].properties.NAME
    }
  }

  return null
}

const mapIncidentsToCityCouncilDistricts = (incidents: IncidentFull[]) => {
  const cityCouncilFeatureCollection = turf.featureCollection(
    JSON.parse(readFileSync(`${assetDirectory}/city_council_districts.geojson`))
  ).features.features

  return incidents.map(x => {
    return {
      ...x,
      cityCouncilDistrict: mapCoordinateToCityCouncilDistrict(
        turf.point([x.longitude, x.latitude]),
        cityCouncilFeatureCollection
      ),
    }
  })
}

module.exports = {
  mapIncidentsToCityCouncilDistricts, mapCoordinateToCityCouncilDistrict, downloadCityCouncilPolygons
}