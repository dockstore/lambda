"use strict";

const app = require("../../app.js");
var event, context;

describe("Tests index", function () {
  beforeEach(function () {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
  });
  it("verifies successful response", async () => {
    const url = "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html";
    await setupTest(url, true);
  });
  it("verifies unsuccessful response", async () => {
    const url =
      "https://this.is.fake.or.private.aws.amazon.com/lambda/latest/dg/welcome.html";
    await setupTest(url, false);
  });
  it("verifies successful response for large file", async () => {
    const url =
      "https://dcc.icgc.org/api/v1/download?fn=/PCAWG/reference_data/data_for_testing/HCC1143_ds/HCC1143.bam";
    await setupTest(url, true);
  });
});

async function setupTest(url, expectedMessage) {
  event = {"queryStringParameters": {
    "url": url
  }};
  const result = await app.lambdaHandler(event, context);
  expect(result).toBeDefined();
  expect(result.statusCode).toBe(200);
  let response = JSON.parse(result.body);
  expect(response).toBeDefined();
  expect(response.message).toBe(expectedMessage);
}
