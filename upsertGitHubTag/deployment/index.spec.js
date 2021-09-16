const lambda = require("./index.js");

describe("installation_repositories event handling", function () {
  it("should return null for random input", function () {
    const postBody = lambda.handleInstallationRepositoriesEvent("fake body");
    expect(postBody).toEqual(null);
  });

  it("should return valid post body", function () {
    const repositories_added = [
      { full_name: "repo1" },
      { full_name: "repo2" },
      { full_name: "repo3" },
    ];
    const fake_payload_body = {
      action: "added",
      sender: { login: "myinfo" },
      installation: { id: "123456" },
      repositories_added: repositories_added,
    };
    const postBody =
      lambda.handleInstallationRepositoriesEvent(fake_payload_body);

    expect(postBody.installationId).toEqual("123456");
    expect(postBody.username).toEqual("myinfo");

    // there should be three repositories
    const repos = postBody.repositories.split(",");
    expect(repos.length).toEqual(3);
    expect(repos[0]).toEqual("repo1");
    expect(repos[1]).toEqual("repo2");
    expect(repos[2]).toEqual("repo3");
  });

  it("should return null for removed action", function () {
    const repositories_added = [
      { full_name: "repo1" },
      { full_name: "repo2" },
      { full_name: "repo3" },
    ];
    const fake_payload_body = {
      action: "removed",
      sender: { login: "myinfo" },
      installation: { id: "123456" },
      repositories_added: repositories_added,
    };
    const postBody =
      lambda.handleInstallationRepositoriesEvent(fake_payload_body);
    expect(postBody).toEqual(null);
  });
});
