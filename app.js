const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize } = require('sequelize');
require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const moment = require('moment');
const { OpenAI } = require('openai');

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OpenAI_Key
});

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

app.post('/generate-response', async (req, res) => {
  const now = moment().format();
  const requestData = req.body;

  fs.appendFileSync('start_time.txt', `${now}\n`);

  const action = getValueFromKey(requestData, 'context.action');
  const context = getValueFromKey(requestData, 'context');

  if (action === 'search') {
      const searchByName = getValueFromKey(requestData, 'message.intent.item.descriptor.name');
      const searchByCat = getValueFromKey(requestData, 'message.intent.provider.categories');
      let searchParams;

      if (searchByName && searchByName.length !== 0) {
          searchParams = {
              action: 'search',
              search_by: 'scheme_name',
              search_value: searchByName
          };
      } else if (searchByCat && searchByCat.length !== 0) {
          const searchByCategory = searchByCat[0]['descriptor']['name'];
          searchParams = {
              action: 'search',
              search_by: 'search_by_category',
              search_value: searchByCategory
          };
      }

      if (searchParams) {
          const searchThread = new Promise((resolve) => {
              runOnSearchAsync(searchParams, context).then(resolve);
          });

          searchThread.then(() => {
              const ackTime = moment().format();
              fs.appendFileSync('ack_time.txt', `${ackTime}\n`);
          });

          res.json({
              message: {
                  ack: {
                      status: 'ACK'
                  }
              }
          });
      } else {
          res.status(400).json({ status: 'error', message: 'name_value required' });
      }
  } else if (action === 'select') {
      const providers = getValueFromKey(requestData, 'message.order.provider');
      const items = getValueFromKey(requestData, 'message.order.items');

      if (providers && items) {
          const selectParams = {
              action: 'select',
              provider_id: providers['id'],
              item_id: items[0]['id']
          };

          const selectThread = new Promise((resolve) => {
              runOnSelectAsync(selectParams, context).then(resolve);
          });

          selectThread.then(() => {
              const ackTime = moment().format();
              fs.appendFileSync('ack_time.txt', `${ackTime}\n`);
          });

          res.json({
              message: {
                  ack: {
                      status: 'ACK'
                  }
              }
          });
      } else {
          res.status(400).json({ status: 'error', message: 'name_value required' });
      }
  } else {
      res.status(400).json({ status: 'error', message: 'Invalid action' });
  }
});

async function runOnSearchAsync(searchParams, context) {
  await onSearch(searchParams, context);
}

async function runOnSelectAsync(selectParams, context) {
  await onSelect(selectParams, context);
}

async function onSearch(searchParams, context) {
  const now = moment().format();

  if (searchParams) {
      const resData = createSqlAndGetData(searchParams);

      const responseData = getApiResponseFmt("search");
      responseData["context"] = context;
      responseData["context"]["action"] = "on_search";

      if (resData) {
          const contextOnSearch = { ...context, action: "on_search" };
          const headers = {
              'Content-Type': 'application/json',
              'User-Agent': '*/*'
          };

          const providerData = {};
          const [locations, locList] = getLocations();

          for (const rows of resData) {
              const schemeId = rows["id"];
              const planningDeptGuid = getListFrstGuid(rows['planning_dept']);

              if (!planningDeptGuid) continue;

              if (!providerData[planningDeptGuid]) {
                  providerData[planningDeptGuid] = {
                      id: planningDeptGuid,
                      descriptor: { name: getParameterName(planningDeptGuid) },
                      categories: [],
                      locations: [],
                      items: [],
                      rateable: false
                  };
              }

              const serviceTypeGuid = getListFrstGuid(rows['service_type']);
              const parName = getParameterName(serviceTypeGuid);
              const parCode = parName.toLowerCase().replace(" ", "-");

              const categories = { id: serviceTypeGuid, descriptor: { code: parCode, name: parName } };

              if (!providerData[planningDeptGuid]["categories"].includes(categories)) {
                  providerData[planningDeptGuid]["categories"].push(categories);
              }

              providerData[planningDeptGuid]["locations"] = locations;

              const items = {
                  id: rows["guid"],
                  descriptor: { name: trimStateCode(rows["name"]), long_desc: rows["description"] },
                  price: { currency: "INR", value: String(rows["pp_gov_fee"]) },
                  rateable: false,
                  tags: getSchTags(schemeId, rows["target_beneficiary"], rows["scheme_type"]),
                  category_ids: [serviceTypeGuid],
                  location_ids: getLocationIds(JSON.parse(rows['applicability']), locList),
                  time: { duration: rows["time_line"] || "" }
              };

              providerData[planningDeptGuid]["items"].push(items);
          }

          responseData["message"]["catalog"]["providers"] = Object.values(providerData);

          const response = await axios.post('https://demo-bpp-client.haqdarshak.com/on_search', responseData, { headers });
      }
  }
}

async function onSelect(selectParams, context) {
  const now = moment().format();

  if (selectParams) {
      const resData = createSqlAndGetData(selectParams);

      const responseData = getApiResponseFmt("select");
      responseData["context"] = context;
      responseData["context"]["action"] = "on_select";

      if (resData) {
          const contextOnSelect = { ...context, action: "on_select" };
          const headers = {
              'Content-Type': 'application/json',
              'User-Agent': '*/*'
          };

          const providerData = {};
          const [locations, locList] = getLocations();

          for (const rows of resData) {
              const schemeId = rows["id"];
              const planningDeptGuid = getListFrstGuid(rows['planning_dept']);

              if (!planningDeptGuid) continue;

              providerData[planningDeptGuid] = providerData[planningDeptGuid] || {
                  id: planningDeptGuid,
                  descriptor: { name: getParameterName(planningDeptGuid) },
                  locations: [],
                  fulfillments: [],
                  items: [],
                  rateable: false
              };

              providerData[planningDeptGuid]["locations"] = locations;

              const fulfillmentsList = getFulfillmentsData(schemeId);
              providerData[planningDeptGuid]["fulfillments"] = fulfillmentsList;

              const items = {
                  id: rows["guid"],
                  descriptor: { name: trimStateCode(rows["name"]), long_desc: rows["description"] },
                  price: { currency: "INR", value: String(rows["pp_gov_fee"]) },
                  rateable: false,
                  tags: getSchTags(schemeId, rows["target_beneficiary"], rows["scheme_type"]),
                  location_ids: getLocationIds(JSON.parse(rows['applicability']), locList),
                  time: { duration: rows["time_line"] || "" }
              };

              providerData[planningDeptGuid]["items"].push(items);
          }

          responseData["message"]["order"]["providers"] = Object.values(providerData);

          const response = await axios.post('https://demo-bpp-client.haqdarshak.com/on_select', responseData, { headers });
      }
  }
}

async function createSqlAndGetData(searchParams) {
  const action = searchParams['action'];

  if (action === 'search') {
      const searchBy = searchParams['search_by'];
      await fs.appendFile("searchBy.txt", String(searchBy));

      if (searchBy === "scheme_name") {
          await fs.appendFile("searchBy.txt", String(searchBy));
          const searchValue = searchParams['search_value'];

          let searchTagsList;
          if (searchValue === "all_schemes") {
              searchTagsList = ["all_schemes"];
          } else {
              const searchTags = getTagsByPersona(searchValue);
              searchTagsList = JSON.parse(searchTags);
          }

          await fs.appendFile("searchTagsList.txt", String(searchTagsList));
          let common_schemes = null;

          for (const searchKey of searchTagsList) {
              let q;
              if (searchKey === "all_schemes") {
                  q = `SELECT s.id FROM schemes s 
                  JOIN schemes_langs sl ON sl.scheme_id = s.id AND sl.lang = 'en'
                  WHERE s.status=5 AND s.country_code = "KE" GROUP BY s.id`;
              } else {
                  q = `SELECT s.id FROM schemes s 
                  JOIN schemes_langs sl ON sl.scheme_id = s.id AND sl.lang = 'en'
                  WHERE 
                  (sl.name LIKE "%${searchKey}%" OR sl.description LIKE "%${searchKey}%" OR sl.process LIKE "%${searchKey}%" OR sl.benefit LIKE "%${searchKey}%" OR sl.objective LIKE "%${searchKey}%") AND
                  s.status=5 AND s.country_code = "KE" GROUP BY s.id`;
              }

              const rows = await fetch_data(q);
              await fs.appendFile("common_schemes_not.txt", JSON.stringify(rows));

              const current_schemes = new Set(rows.map(row => row.id));
              if (common_schemes === null) {
                  common_schemes = current_schemes;
              } else {
                  common_schemes = new Set([...common_schemes].filter(x => current_schemes.has(x)));
              }
          }

          await fs.appendFile("common_schemes.txt", JSON.stringify([...common_schemes]));

          if (common_schemes.size) {
              const common_schemes_str = [...common_schemes].join(',');
              const q = `SELECT s.id, s.guid, s.value, s.pp_gov_fee, s.target_beneficiary, s.scheme_type, s.applicability,
                  s.time_line, s.fulfillment_touchpoint, IF(s.planning_dept='', '["PM0001M0"]', s.planning_dept) AS planning_dept, s.service_type,
                  sl.name, sl.description, sl.process, sl.benefit 
              FROM schemes s 
              JOIN schemes_langs sl ON sl.scheme_id = s.id AND sl.lang = 'en'
              LEFT JOIN scheme_rules sr ON sr.scheme_id = s.id
              WHERE s.status=5 AND s.id IN(${common_schemes_str}) GROUP BY s.id`;

              await fs.appendFile("rows.txt", q);
              const rows = await fetch_data(q);
              await fs.appendFile("rows1.txt", JSON.stringify(rows));
              return rows;
          } else {
              const planning_dept = get_srch_tags_planning_dept_det(searchValue);
              if (planning_dept !== null) {
                  const q = `SELECT s.id, s.guid, s.value, s.pp_gov_fee, s.target_beneficiary, s.scheme_type, s.applicability,
                      s.time_line, s.fulfillment_touchpoint, IF(s.planning_dept='', '["PM0001M0"]', s.planning_dept) AS planning_dept, s.service_type,
                      sl.name, sl.description, sl.process, sl.benefit 
                  FROM schemes s 
                  JOIN schemes_langs sl ON sl.scheme_id = s.id AND sl.lang = 'en'
                  LEFT JOIN scheme_rules sr ON sr.scheme_id = s.id
                  WHERE s.status=5 AND s.planning_dept LIKE '%${planning_dept}%' AND s.country_code = "KE" GROUP BY s.id`;
                  const rows = await fetch_data(q);
                  return rows;
              } else {
                  return [];
              }
          }
      } else if (searchBy === "search_by_category") {
          const searchValue = searchParams['search_value'];
          await fs.appendFile("searchValue.txt", String(searchValue));

          const serviceTypeMapping = {
              "health insurance": "PM0001LO",
              "social assistance": "PM0001LP",
              "non- health insurance": "PM0001LQ",
              "agriculture(including loans)": "PM0001LR",
              "energy": "PM0001LS",
              "savings and investment": "PM0001LT",
              "education(including education loan)": "PM0001LU",
              "health care": "PM0001LV",
              "loan/credit for self employment/enterprise": "PM0001LW",
              "issue new document": "PM0001LX",
              "update / correct document": "PM0001LY"
          };
          const serviceTypeCode = serviceTypeMapping[searchValue.toLowerCase()] || '';

          const q = `SELECT s.id, s.guid, s.value, s.pp_gov_fee, s.target_beneficiary, s.scheme_type, s.applicability,
              s.time_line, s.fulfillment_touchpoint, IF(s.planning_dept='', '["PM0001M0"]', s.planning_dept) AS planning_dept, s.service_type,
              sl.name, sl.description, sl.process, sl.benefit 
              FROM schemes s 
              JOIN schemes_langs sl ON sl.scheme_id = s.id AND sl.lang = 'en'
              WHERE s.service_type LIKE "%${serviceTypeCode}%" AND s.status = 5
              GROUP BY s.id`;

          const rows = await fetch_data(q);
          await fs.appendFile("rows.txt", JSON.stringify(rows));
          await fs.appendFile("query.txt", q);
          return rows;
      }
  } else if (action === 'select') {
      const provider_id = searchParams['provider_id'];
      const item_id = searchParams['item_id'];

      const q = `SELECT s.id, s.guid, s.value, s.pp_gov_fee, s.target_beneficiary, s.scheme_type, s.applicability,
          s.time_line, s.fulfillment_touchpoint, IF(s.planning_dept='', '["PM0001M0"]', s.planning_dept) AS planning_dept, s.service_type,
          sl.name, sl.description, sl.process, sl.benefit 
      FROM schemes s 
      JOIN schemes_langs sl ON sl.scheme_id = s.id AND sl.lang = 'en'
      LEFT JOIN scheme_rules sr ON sr.scheme_id = s.id
      WHERE s.guid = '${item_id}'
      GROUP BY s.id`;

      const rows = await fetch_data(q);
      await fs.appendFile("rows.txt", q + JSON.stringify(rows));
      return rows;
  }

  await connection.end();
}

async function getTagsByPersona(data) {
  const message = data;

  const systemMessage = "I am having database of schemes and I want to search words in that database. So I want that exact words from given text which is provided, do not give other words which are not in the text. give me only words not sentence in object.exclude word scheme/schemes if there.exclude verbs. list should be ['first word', 'second word', etc] without keys:";

  const messages = [
      { role: "system", content: systemMessage },
      { role: "user", content: message }
  ];

  try {
      const response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: messages
      });

      const reply = response.choices[0].message.content;
      messages.push({ role: "assistant", content: reply });

      return reply;
  } catch (error) {
      console.error('Error fetching data from OpenAI:', error);
      throw error;
  }
}
  
app.listen(3000, () => {
  console.log('Server is running on port 3000');
});

module.exports = app;
