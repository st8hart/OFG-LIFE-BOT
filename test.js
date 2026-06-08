const https = require('https');

const payload = JSON.stringify({
  template: "A37YJe5qwwj0bmpvWK",
  modifications: [
    {
      name: "Photo_1",
      image_url: "https://i.imgur.com/NZzZCCL.jpeg"
    },
    {
      name: "Agent_name_1",
      text: "Zach Denha"
    },
    {
      name: "Agent_Production_1",
      text: "$5,466"
    },
    {
      name: "Month_Lable",
      text: "JUNE 2026"
    },
    {
      name: "Week_label",
      text: "WEEK 1"
    },
    {
      name: "Production",
      text: "$106,024"
    },
    {
      name: "Producers",
      text: "18 AGENTS"
    }
  ]
});

const options = {
  hostname: "api.bannerbear.com",
  path: "/v2/images",
  method: "POST",
  headers: {
    "Authorization": "Bearer bb_pr_9deebd481a3e2d1d48b1b70d5d3019",
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  }
};

const req = https.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => { data += chunk; });
  res.on("end", () => {
    try {
      const result = JSON.parse(data);
      console.log("Full response:", JSON.stringify(result, null, 2));
    } catch(e) {
      console.log("Raw response:", data);
    }
  });
});

req.on("error", (e) => console.error("Error:", e));
req.write(payload);
req.end();