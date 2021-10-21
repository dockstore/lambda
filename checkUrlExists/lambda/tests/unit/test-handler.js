"use strict";

const app = require("../../index.js");
var event, context;

describe("Tests index", function () {
  beforeEach(function () {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
  });
  it("verifies successful response from http", async () => {
    const url = "http://docs.aws.amazon.com/lambda/latest/dg/welcome.html";
    await setupTest(url, true);
  });
  it("verifies successful response from https", async () => {
    const url = "https://www.google.ca";
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
  it("verifies successful response from ftp file", async () => {
    const url = "ftp://ftp.ensembl.org/pub/release-100/tsv/homo_sapiens/Homo_sapiens.GRCh38.100.entrez.tsv.gz";
    await setupTest(url, true);
  });
  it("verifies unsuccessful response from ftp file", async () => {
    const url =
      "ftp://ftp.this.is.fake.or.private.1000genomes.ebi.ac.uk/vol1/ftp/CHANGELOG";
    await setupTest(url, false);
  });
});

async function setupTest(url, expectedMessage) {
  event = {
    queryStringParameters: {
      url: url,
    },
  };
  const result = await app.lambdaHandler(event, context);
  expect(result).toBeDefined();
  expect(result.statusCode).toBe(200);
  let response = JSON.parse(result.body);
  expect(response).toBeDefined();
  expect(response.message).toBe(expectedMessage);
}
