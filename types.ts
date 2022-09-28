export type IncidentSummary = {
  "key": string;
  "raw": string;
  "ts": number;
  "date": string;
  "ll": number[];
  "shareMap": string;
}

export type IncidentFull = {
  "address": string;
  "broadcastRules": {
    "distanceMeters": number;
    "deadline": number;
  },
  "cityCode":string;
  "cs": number;
  "hasVod":false;
  "key": string;
  "level":1;
  "location": string;
  "latitude": number;
  "longitude": number;
  "neighborhood": string;
  "raw": string;
  "ll": number[];
  "rawLocation": string;
  "title": string;
  "transcriber": string;
  "ts": number;
  "police":"";
  "shareImageText":"";
  "shareMap": string;
  "homescreenMapThumbnail": string;
  "updates":{
    [key: string]: {
      "text": string;
      "ts": number;
      "type": string;
      "displayLocation": string;
    };
  };
  "nearbyThreshold": number;
  "recentThreshold": number;
  "recencyThreshold": number;
  "twitterHandle": string;
  "placeholderImageURL": string;
  "facepile":null;
  "severity": string;
  "source": string;
  "chatBlocked":false;
  "closed":false;
  "modules":[
    {
      "id": string;
      "type": string;
      "title": string;
      "rank": number;
      "template":{
        "name": string;
        "gcsUrl": string;
      }
    }
  ];
  "videoPreviewFeatured":false;
  "isGoodNews":false;
  "magicMomentsTag":null;
  "displayStyle": string;
  "categories": string[];
  "incidentSettings":{
    "displayStyle": string;
    "mapVisibility": string;
  }
}