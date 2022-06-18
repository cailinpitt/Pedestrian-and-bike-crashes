A Twitter bot that tweets Bicyclist and Pedestrian related crashes, using Citizen data.

![Tweet screenshot](example.png)

### Run
`npm install` to fetch and install dependencies.

To run: `node index.js --location cityNameOne`, where `cityNameOne` is the name of the city you want to fetch and tweet data for (see `keys` section for more information).

### Keys file
To use, create a `keys.file` with the following format for each city you want to fetch and tweet data for:

```js
module.exports = {
    cityNameOne: {
        consumer_key: 'consumer_key',
        consumer_secret: 'consumer_secret',
        access_token: 'access_token',
        access_token_secret: 'access_token_secret',
        lowerLatitude: 'lowerLatitude',
        lowerLongitude: 'lowerLongitude',
        upperLatitude: 'upperLatitude',
        upperLongitude: 'upperLongitude',
        timeZone: 'America/New_York',
    },
    cityNameTwo: {
        consumer_key: 'consumer_key',
        consumer_secret: 'consumer_secret',
        access_token: 'access_token',
        access_token_secret: 'access_token_secret',
        lowerLatitude: 'lowerLatitude',
        lowerLongitude: 'lowerLongitude',
        upperLatitude: 'upperLatitude',
        upperLongitude: 'upperLongitude',
        timeZone: 'America/Los_Angeles',
    },
    ...
};
```

To get the `consumer_key`, `consumer_secret`, `access_token`, and `access_token_secret` values, you'll need to sign up for a [Twitter Developer account](https://developer.twitter.com/en).

To get the `lowerLatitude`, `lowerLongitude`, `upperLatitude`, and `upperLongitude` values, you'll need to go to the [Citizen explore page](https://citizen.com/explore). Open up the developer tools in your browser, go to the network tab, and select the city you want to see incidents for. Select the `trending` API call and the latitude and longitude values are the parameters in the URL.

The `timeZone` value is used for converting incident times (Citizen stores them in UTC) to the city's local time. The `timeZone` value for your city can be found [here](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) - use the value in the `TZ database name` column. If your city isn't listed just use the closest major city (ex. for Philadelphia use America/New_York).