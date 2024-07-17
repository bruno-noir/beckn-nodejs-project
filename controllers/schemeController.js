const fetchData = require('../utils/fetchData');

const dict_target_beneficiary = {
  "0": { "code": "Ind", "name": "Individual" },
  "1": { "code": "MSME", "name": "Enterprise" },
  "2": { "code": "Both", "name": "Both Individual and MSME" }
};

const sch_type_description = {
  "Centrally Sponsored Scheme (CSS)": "Centrally Sponsored Schemes as defined by the National Development Council are: those that are funded directly by the central ministries/ departments and implemented by states or their agencies, irrespective of their pattern of financing, unless they fall under the centre’s sphere of responsibility i.e. the union list. This assistance is deliberately in areas that are State subjects, with the centre wishing to motivate the States to take up such programs.",
  "Additional Central Assistance": "Additional Central Assistance (ACA) linked schemes provide central assistance to the states for the state plan schemes. This assistance is meant for special programs as per the needs of the State, sectoral priorities and cover subjects not on the union list. The ACA linked schemes are funded by the ministry of finance and administered by the sectoral ministry concerned.",
  "Central Sector Scheme": "Central Sector Schemes are those that are implemented by a central agency and 100% funded by the center on subjects within the union list."
};

// Example function, you'll need to convert all provided functions similarly
async function getFulfillmentsData(schemeId) {
  const q = `SELECT link FROM scheme_urls WHERE scheme_id=${schemeId} AND title LIKE '%application link%'`;
  const result = await fetchData(q);
  let appLink = "";
  if (result.length) {
    const row = result[0];
    appLink = getFirstGuid(row.link);
  }
  const res = [
    {
      stops: [
        {
          type: "REGISTRATION",
          instructions: {
            name: "Application link",
            media: { url: appLink }
          }
        }
      ]
    }
  ];
  return res;
}

function getFirstGuid(guidList) {
  const guids = JSON.parse(guidList);
  return guids[0];
}

// Export all other functions similarly
module.exports = { getFulfillmentsData, /* add other functions here */ };
