const expect = require('chai').expect;
const sinon = require('sinon');
const rewire = require('rewire');

const axios = require('axios');
const index = rewire('../index');
const fetchIncidents = index.__get__('fetchIncidents');
const tweetThread = index.__get__('tweetThread');
const validateInputs = index.__get__('validateInputs');
const filterIncidents = index.__get__('filterIncidents');

let clientSpy;
let consoleSpy;

let sandbox;
beforeEach(() => {
  sandbox = sinon.createSandbox();
});

afterEach(function () {
  sandbox.restore();
});

describe('index', function() {
  describe('fetchIncidents', function() {
    it('fetches incidents', async function () {
      const expectedResponse = {
        data: {
          results: [
            {
              address: "123 Main Street",
              title: "Pedestrian struck",
            }
          ],
        },
      };

      const axiosStub = sinon.stub(axios, "get").resolves(expectedResponse);
  
      const result = await fetchIncidents(1, 2, 3, 4);
  
      expect(result).to.eql(expectedResponse.data.results);
      expect(axiosStub.calledWith("https://citizen.com/api/incident/trending?lowerLatitude=1&lowerLongitude=2&upperLatitude=3&upperLongitude=4&fullResponse=true&limit=200")).to.be.true;
    });
  });

  describe(`filterIncidents`, function () {

    it('preserves relevant incidents based on title/raw', function () {
      const incidents = [
        {
          ts: 1671140938298 + 1671140938298,
          title: "Pedestrian struck",
          raw: "A driver struck a pedestrian",
        }
      ];

      const result = filterIncidents(incidents);

      expect(result).to.eql(incidents);
    });

    it('filters out irrelevant incidents based on title/raw', function () {
      const incidents = [
        {
          ts: 1671140938298 + 1671140938298,
          title: "Pedestrian struck",
          raw: "A driver struck a pedestrian",
        },
        {
          ts: 1671140938298 + 1671140938298,
          title: "Dog eating",
          raw: "A dog was spotted eating a burger",
        },
      ];

      const result = filterIncidents(incidents);

      expect(result).to.eql([incidents[0]]);
    });

    it('preserves relevant incidents based on updates', function () {
      const incidents = [
        {
          ts: 1671140938298 + 1671140938298,
          title: "Dog eating",
          raw: "A dog was spotted eating a burger",
          updates: {
            one: {
                text: "First responders are responding to a pedestrian being hit by a driver",
            },
          },
        }
      ];

      const result = filterIncidents(incidents);

      expect(result).to.eql(incidents);
    });

    it('filters out irrelevant incidents based on updates', function () {
      const incidents = [
        {
          ts: 1671140938298 + 1671140938298,
          title: "Dog eating",
          raw: "A dog was spotted eating a burger",
          updates: {
            one: {
                text: "First responders are responding to a pedestrian being hit by a driver",
            },
          },
        },
        {
          ts: 1671140938298 + 1671140938298,
          title: "Dog eating",
          raw: "A dog was spotted eating a burger",
          updates: {
            one: {
                text: "First responders are responding to a dog eating a burger",
            },
          },
        },
      ];

      const result = filterIncidents(incidents);

      expect(result).to.eql([incidents[0]]);
    });

    describe('fire hydrants', function () {
      it('preserves relevant incidents that include fire hydrants', function () {
        const incidents = [
          {
            ts: 1671140938298 + 1671140938298,
            title: "Fire hydrant and pedestrian struck",
            raw: "A driver struck multiple objects",
          },
        ];
  
        const result = filterIncidents(incidents);
  
        expect(result).to.eql(incidents);
      });

      it('filters out irrelevant incidents that include fire hydrants', function () {
        const incidents = [
          {
            ts: 1671140938298 + 1671140938298,
            title: "Fire hydrant and ball struck",
            raw: "A driver struck multiple objects",
          },
        ];
  
        const result = filterIncidents(incidents);
  
        expect(result).to.eql([]);
      });
    });
  });

  describe('tweetThread', function () {
    const tweets = ["tweet 1", "tweet 2"];

    beforeEach(function () {
      clientSpy = {
        v2: {
          tweetThread: sandbox.spy(),
        },
      };
      consoleSpy = sandbox.spy(console, 'log');
    });
    

    it('it tweets thread when dryRun is false', async function () {
      await tweetThread(clientSpy, tweets, false);

      expect(clientSpy.v2.tweetThread.calledWith(tweets)).to.be.true;
    });

    it('it logs thread when dryRun is true', async function () {
      await tweetThread(clientSpy, tweets, true);

      expect(clientSpy.v2.tweetThread.calledWith(tweets)).to.be.false;
      expect(consoleSpy.calledWith(tweets)).to.be.true;
    });
  });

  describe('validateInputs', function () {
    describe('location', function () {
      it('requires location to be passed in', function () {
        try {
          validateInputs(undefined, false, false);
        } catch (error) {
          expect(error.message).to.eql('location must be passed in');
          return;
        }
  
        expect.fail('Should have thrown');
      });
    });
  });
});
