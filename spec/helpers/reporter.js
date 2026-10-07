const SpecReporter = require("jasmine-spec-reporter").SpecReporter;

jasmine.getEnv().clearReporters(); // remove default reporter logs
jasmine.getEnv().addReporter(
  new SpecReporter({
    // add jasmine-spec-reporter
    spec: {
      displayPending: true,
    },
  })
);

// Write JUnit XML on CircleCI so store_test_results can show a test summary
if (process.env.CIRCLECI) {
  const reporters = require("jasmine-reporters");
  jasmine.getEnv().addReporter(
    new reporters.JUnitXmlReporter({
      savePath: "test-results/jasmine",
      consolidateAll: true,
    })
  );
}
