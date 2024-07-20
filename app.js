const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize } = require('sequelize');
require('dotenv').config();
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
  host: process.env.DB_HOST,
  dialect: 'mysql',
  port: process.env.DB_PORT || 3306,
});

// Function to fetch data using Sequelize
async function fetch_data(query) {
  try {
    const [results, metadata] = await sequelize.query(query);
    return results;
  } catch (error) {
    console.error('Error executing query:', error);
    throw error;
  }
}
// app.get('/', async (req, res) => {
//     try {
//       await sequelize.authenticate();
//       console.log('Connection has been established successfully.');
//       res.send("Database connection successful!");
//     } catch (error) {
//       console.error('Unable to connect to the database:', error);
//       res.send("Database connection failed.");
//     }
//   });
const dict_target_beneficiary = {
  "0": { "code": "Ind", "name": "Individual" },
  "1": { "code": "MSME", "name": "Enterprise" },
  "2": { "code": "Both", "name": "Both Individual and MSME" }
};

const sch_type_description = {
  "Centrally Sponsored Scheme (CSS)": `Centrally Sponsored Schemes as defined by the National Development Council are: those that are
      funded directly by the central ministries/ departments and implemented by states or their agencies,
      irrespective of their pattern of financing, unless they fall under the centre’s sphere of responsibility
      i.e. the union list. This assistance is deliberately in areas that are State subjects, with the
      centre wishing to motivate the States to take up such programs.`,
  
  "Additional Central Assistance": `Additional Central Assistance (ACA) linked schemes provide central assistance to the states for the
      state plan schemes. This assistance is meant for special programs as per the needs of the State, sectoral
      priorities and cover subjects not on the union list. The ACA linked schemes are funded by the ministry
      of finance and administered by the sectoral ministry concerned.`,
  
  "Central Sector Scheme": `Central Sector Schemes are those that are implemented by a central agency and 100% funded by the center
      on subjects within the union list.`
};

app.get('/', async (req, res) => {
  const q = `SELECT * FROM concept WHERE id=35`;
  const rows = await fetch_data(q);
  fs.appendFileSync("test.txt", JSON.stringify(rows));
  res.send("Hello, world. You're at the polls index.");
});

function getValueFromKey(jsonData, key) {
  const keys = key.split('.');
  let currentData = jsonData;

  try {
    for (const k of keys) {
      currentData = currentData[k];
    }
    return currentData;
  } catch (error) {
    return null;
  }
}

function getApiResponseFmt(apiAction = 'search') {
  const par_key = apiAction === "select" ? "order" : "catalog";
  const providers_dtype = apiAction === "select" ? {} : [];

  return {
    "context": {},
    "message": {
      [par_key]: {
        "descriptor": { "name": "Haqdarshak Government Schemes" },
        "providers": providers_dtype
      }
    }
  };
}

async function getFulfillmentsData(scheme_id) {
  const q = `SELECT link FROM scheme_urls WHERE scheme_id=${scheme_id} AND title LIKE '%application link%'`;
  const result = await fetch_data(q);
  let app_link = "";
  if (result && result.length > 0) {
    const row = result[0];
    const applink = row['link'];
    app_link = getListFrstGuid(applink);
  }

  return [
    {
      "stops": [
        {
          "type": "REGISTRATION",
          "instructions": {
            "name": "Application link",
            "media": { "url": app_link }
          }
        }
      ]
    }
  ];
}

function trimStateCode(par_name) {
  const plist = par_name.split('_');
  if (plist.length === 2) {
    if (plist[0].length === 2) {
      return plist[1];
    } else if (plist[1].length === 2) {
      return plist[0];
    }
  }
  return par_name;
}

async function getTgEligibilityTags(scheme_id) {
  const q = `SELECT r.id, r.concept, c.category, c.title, r.operator, r.value, dt.hl7_abbreviation, d.description as name 
             FROM scheme_rules r 
             JOIN concept c ON (r.concept=c.guid)
             JOIN concept_datatype dt ON (dt.id=c.datatype_id)
             JOIN concept_description d ON (d.concept_id=c.id AND d.locale='en')
             WHERE r.scheme_id=${scheme_id}`;
  const result = await fetch_data(q);

  const res = {};
  if (result) {
    for (const r of result) {
      let category = r["category"];
      const code_cat = {
        'Social eligibility': "social-eligibility",
        'Academic eligibility': "academic-eligibility",
        'Economic eligibility': "economic-eligibility",
        'Health eligibility': "health-eligibility",
        'Additional eligibility': "additional-eligibility",
        'Demographic eligibility': "demographic-eligibility"
      }[category] || category;

      const title = r["title"];
      category = category || "Others";

      if (!res[category]) {
        res[category] = {
          display: true,
          descriptor: { code: String(code_cat), name: String(category) },
          list: []
        };
      }

      let value = r['value'];
      if (r['hl7_abbreviation'].trim() === 'CWE') {
        const q2 = `SELECT d.description as value FROM concept c 
                    JOIN concept_description d ON (d.concept_id=c.id AND d.locale='en')
                    WHERE c.guid='${value}'`;
        const result2 = await fetch_data(q2);
        if (result2 && result2.length > 0) {
          const r2 = result2[0];
          value = r2['value'];
        }
      }
      if (value.startsWith("LT")) {
        const castes = getCasteForState('Maharashtra', 'en');
        value = Object.values(castes).find(val => val.includes(value)) || "";
      }

      const tg = {
        descriptor: { code: r['concept'], name: String(title) },
        value: `${r['operator']} ${String(value)}`,
        display: true
      };

      if (!res[category].list.some(item => JSON.stringify(item) === JSON.stringify(tg))) {
        res[category].list.push(tg);
      }
    }
    return Object.values(res);
  }
  return res;
}

async function getTgBenefitTags(scheme_id) {
  const q = `SELECT id, category, benefit FROM scheme_category_benefits WHERE scheme_id=${scheme_id} AND lang='en'`;
  const result = await fetch_data(q);

  const res = {
    display: true,
    descriptor: { code: "benefit", name: "Benefit" },
    list: []
  };
  if (result) {
    for (const r of result) {
      const tg = {
        descriptor: { code: r['category'], name: r['category'] },
        value: r['benefit'],
        display: true
      };
      res.list.push(tg);
    }
  }
  return res;
}

async function getTgShortBenefitTags(scheme_id) {
  const q = `SELECT benefit FROM schemes_langs WHERE scheme_id=${scheme_id} AND lang='en'`;
  const result = await fetch_data(q);

  const res = {
    display: true,
    descriptor: { code: "short-benefit", name: "Short Benefit" },
    list: []
  };
  if (result) {
    for (const r of result) {
      const tg = {
        descriptor: { code: 'short-benefit', name: 'Short Benefit' },
        value: r['benefit'],
        display: true
      };
      res.list.push(tg);
    }
  }
  return res;
}

async function getTgReqDocsTags(scheme_id) {
  const q = `SELECT sdr.scheme_id, sl.name as document_name, pl.name as purpose_id, 
                    CASE 
                      WHEN plm.name='Must have' THEN 'Mandatory document'
                      WHEN plm.name='Any one' THEN 'Optional document' 
                      ELSE plm.name 
                    END as mode 
             FROM scheme_documents_relation sdr
             JOIN schemes_langs sl ON sl.scheme_id=sdr.document_id AND sl.lang='en'
             JOIN parameters p ON p.id=sdr.purpose_id
             JOIN parameter_langs pl ON pl.parameter_id=p.id AND pl.locale='en'
             JOIN parameters pm ON pm.guid=sdr.mode
             JOIN parameter_langs plm ON plm.parameter_id=pm.id AND plm.locale='en'
             WHERE sdr.scheme_id=${scheme_id}`;
  const result = await fetch_data(q);

  const res = {
    display: true,
    descriptor: { code: "required-docs", name: "Required documents" },
    list: []
  };
  if (result) {
    for (const r of result) {
      const tg = {
        descriptor: { code: r['mode'] === 'Mandatory document' ? "mandatory-doc" : "optional-doc", name: r['document_name'] },
        value: r['purpose_id'],
        display: true
      };
      res.list.push(tg);
    }
  }
  return res;
}

async function getTargetBeneficiaryTags(target_beneficiary) {
  const res = {
    display: true,
    descriptor: { code: "target-beneficiary", name: "Target Beneficiary" },
    list: []
  };
  const dict_keys = Object.keys(dict_target_beneficiary);
  for (const key of dict_keys) {
    if (target_beneficiary === dict_target_beneficiary[key]["code"]) {
      const tg = {
        descriptor: { code: "target-beneficiary", name: "Target Beneficiary" },
        value: dict_target_beneficiary[key]["name"],
        display: true
      };
      res.list.push(tg);
    }
  }
  return res;
}

async function getSchemeTypeTags(scheme_type) {
  const res = {
    display: true,
    descriptor: { code: "scheme-type", name: "Scheme Type" },
    list: []
  };
  for (const [key, value] of Object.entries(sch_type_description)) {
    if (key === scheme_type) {
      const tg = {
        descriptor: { code: "scheme-type", name: key },
        value: value,
        display: true
      };
      res.list.push(tg);
    }
  }
  return res;
}

async function getSchemeTags(scheme_id, target_beneficiary, scheme_type) {
  const tg_beneficiary = await getTargetBeneficiaryTags(target_beneficiary);
  const tg_funding = await getSchemeTypeTags(scheme_type);
  const tg_eligibility = await getTgEligibilityTags(scheme_id);
  const tg_benefit = await getTgBenefitTags(scheme_id);
  const tg_short_benefit = await getTgShortBenefitTags(scheme_id);
  const tg_req_docs = await getTgReqDocsTags(scheme_id);

  const tags = [
    ...tg_beneficiary.list,
    ...tg_funding.list,
    ...tg_short_benefit.list,
    ...tg_eligibility,
    ...tg_benefit.list,
    ...tg_req_docs.list
  ];

  return tags;
}

async function getParameterName(planning_dept_guid) {
  const q = `SELECT l.name FROM parameters p JOIN parameter_langs l ON (p.id=l.parameter_id AND l.locale='en') WHERE p.guid='${planning_dept_guid}'`;
  const result = await fetch_data(q);
  if (result && result.length > 0) {
    return result[0]['name'];
  }
  return null;
}

function getListFrstGuid(par_guidlist) {
  const par_guids = JSON.parse(par_guidlist);
  return par_guids[0];
}

async function getSrchTagsPlanningDeptDet(tags_name) {
  const q = `SELECT p.guid FROM parameters p JOIN parameter_langs l ON (p.id=l.parameter_id AND l.locale='en') WHERE p.class=4 AND l.name LIKE '%${tags_name}%'`;
  const result = await fetch_data(q);
  if (result && result.length > 0) {
    return result[0]['guid'];
  }
  return null;
}

async function getSrchTagsConceptDet(par_name) {
  const q = `SELECT p.guid FROM concept p JOIN concept_name l ON (p.id=l.concept_id AND l.locale='en') WHERE l.name ='${par_name}' ORDER BY p.id ASC`;
  const result = await fetch_data(q);
  if (result && result.length > 0) {
    return result[0]['guid'];
  }
  return null;
}

async function getSrchTagsConceptAnsDet(par_name) {
  const q = `SELECT p.guid FROM concept p 
             JOIN concept_name l ON (p.id=l.concept_id AND l.locale='en')
             JOIN concept_answer a ON (p.id=a.answer_concept)
             JOIN scheme_rules r ON (p.guid=r.value)
             WHERE l.name ='${par_name}' GROUP BY p.id`;
  const result = await fetch_data(q);
  if (result && result.length > 0) {
    return result[0]['guid'];
  }
  return null;
}

async function getLocations() {
  const lang = "en";
  const q = `SELECT state_code, state_name, state_short_name FROM lgd_state WHERE lang='${lang}'`;
  const result = await fetch_data(q);

  const locations = [];
  const loc_list = {};
  if (result) {
    for (const r of result) {
      const loc = { id: r["state_code"], state: { code: "", name: r["state_name"] }, country: { code: "IN", name: "India" } };
      loc["state"]["code"] = "IN-" + String(r["state_short_name"]);
      locations.push(loc);
      loc_list[r["state_short_name"]] = r["state_code"];
    }
  }
  return [locations, loc_list];
}

async function getLocationsKenya() {
  const lang = "en";
  const q = `SELECT state_code, state_name, state_short_name FROM lgd_state_kenya`;
  const result = await fetch_data(q);

  const locations = [];
  const loc_list = {};
  if (result) {
    for (const r of result) {
      const loc = { id: r["state_code"], state: { code: "", name: r["state_name"] }, country: { code: "KE", name: "Kenya" } };
      loc["state"]["code"] = String(r["state_short_name"]);
      locations.push(loc);
      loc_list[r["state_short_name"]] = r["state_code"];
    }
  }
  return [locations, loc_list];
}

function getLocationIds(applicability_list, loc_list) {
  return applicability_list.filter(item => loc_list.hasOwnProperty(item)).map(item => loc_list[item]);
}


  
app.listen(3000, () => {
  console.log('Server is running on port 3000');
});

module.exports = app;
