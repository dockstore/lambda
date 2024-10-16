"use strict";
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const url = require("url");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const LAMBDA_USER_AGENT = "DockstoreLambda (NodeJs)";
const DELIVERY_ID_HEADER = "X-GitHub-Delivery";
const client = new S3Client({});

// Verification function to check if it is actually GitHub who is POSTing here
const verifyGitHub = (req, payload) => {
  if (!req["user-agent"].includes("GitHub-Hookshot")) {
    return false;
  }
  // Compare their hmac signature to our hmac signature
  // (hmac = hash-based message authentication code)
  const theirSignature = req["X-Hub-Signature"];
  const secret = process.env.SECRET_TOKEN;
  const ourSignature = `sha1=${crypto
    .createHmac("sha1", secret)
    .update(payload)
    .digest("hex")}`;
  return crypto.timingSafeEqual(
    Buffer.from(theirSignature),
    Buffer.from(ourSignature)
  );
};

function getProtocol(url) {
  return url.protocol === "http:" ? http : https;
}

// Makes a POST request to the given path
function postEndpoint(path, postBody, deliveryId, callback) {
  console.log("POST " + path);
  console.log(postBody);

  const options = url.parse(path);
  options.method = "POST";
  options.headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + process.env.DOCKSTORE_TOKEN,
    "User-Agent": LAMBDA_USER_AGENT,
    "X-GitHub-Delivery": deliveryId,
  };

  const req = getProtocol(options).request(options, (res) => {
    var chunks = [];
    var bodyString = "";

    res.on("data", function (chunk) {
      chunks.push(chunk);
      bodyString += chunk.toString();
    });

    res.on("end", function () {
      if (callback) {
        // If content-type is text/plain, the body contains the message, else the message is found in the JSON object
        var contentType = res.headers["content-type"];
        var responseMessage =
          contentType && contentType.includes("text/plain")
            ? bodyString
            : res.statusMessage;
        callback({
          statusCode: res.statusCode,
          statusMessage: responseMessage,
        });
      }
    });
    return res;
  });
  req.write(JSON.stringify(postBody));
  req.end();
}

// Makes a DELETE request to the given path
function deleteEndpoint(
  path,
  repository,
  reference,
  username,
  installationId,
  deliveryId,
  callback
) {
  console.log("DELETE " + path);

  const urlWithParams = new URL(path);
  urlWithParams.searchParams.append("gitReference", reference);
  urlWithParams.searchParams.append("repository", repository);
  urlWithParams.searchParams.append("username", username);
  urlWithParams.searchParams.append("installationId", installationId);

  const options = url.parse(urlWithParams.href);
  options.method = "DELETE";
  options.headers = {
    Authorization: "Bearer " + process.env.DOCKSTORE_TOKEN,
    "User-Agent": LAMBDA_USER_AGENT,
    "X-GitHub-Delivery": deliveryId,
  };

  const req = getProtocol(options).request(options, (res) => {
    var chunks = [];

    res.on("data", function (chunk) {
      chunks.push(chunk);
    });

    res.on("end", function () {
      if (callback) {
        callback({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
        });
      }
    });
  });
  req.end();
}

function handleReleaseEvent(githubEventType, body, deliveryId, path, callback) {
  console.log("Valid release event ", deliveryId);
  const fullPath = path + "workflows/github/taggedrelease";
  logPayloadToS3(githubEventType, body, deliveryId);
  postEndpoint(fullPath, body, deliveryId, (response) => {
    handleCallback(response, "", callback);
  });
}

// Performs an action based on the event type (action)
function processEvent(event, callback) {
  // Usually returns array of records, however it is fixed to only return 1 record
  console.log(JSON.stringify(event));
  var loneEvent = event.Records[0];
  var requestBody = JSON.parse(loneEvent.body);

  // Print SQS message ID or null or undefined
  const messageId = loneEvent.messageId;
  const messageText = `message ID is: ${messageId}`;
  console.log(messageText);

  // The payload is encoded in base64
  const buff = Buffer.from(requestBody.payload, "base64");
  const bodyDecoded = buff.toString("utf8");
  const body = JSON.parse(bodyDecoded);

  if (!verifyGitHub(requestBody, bodyDecoded)) {
    console.log("GitHub could not be verified");
    console.log("GitHub Payload");
    console.log(JSON.stringify(body));
    callback(null, {
      statusCode: 403,
      body: "something is wrong, github secret does not match",
    });
    return;
  } else {
    console.log("GitHub is verified");
  }

  var path = process.env.API_URL;

  var deliveryId;
  if (requestBody[DELIVERY_ID_HEADER]) {
    deliveryId = requestBody[DELIVERY_ID_HEADER];
  } else {
    // TODO: remove this after 1.15.
    // This was added because there's a small period of time during the 1.15 deploy where the header isn't available
    console.log(
      "Could not retrieve X-GitHub-Delivery header, generating a random UUID"
    );
    deliveryId = crypto.randomUUID();
  }

  console.log("X-GitHub-Delivery: " + deliveryId);
  var githubEventType = requestBody["X-GitHub-Event"];
  // Handle installation events
  if (githubEventType === "installation_repositories") {
    // The installation_repositories event contains information about both additions and removals.
    console.log("Valid installation event ", deliveryId);

    logPayloadToS3(githubEventType, body, deliveryId); //upload event to S3

    path += "workflows/github/install";
    postEndpoint(path, body, deliveryId, (response) => {
      const added = body.action === "added";
      const repositories = (
        added ? body.repositories_added : body.repositories_removed
      ).map((repo) => repo.full_name);
      const successMessage = `The GitHub app was successfully ${
        added ? "installed" : "uninstalled"
      } on repositories ${repositories}`;
      handleCallback(response, successMessage, callback);
    });
  } else if (githubEventType === "push") {
    /**
     * We only handle push events, of which there are many subtypes. Unfortunately, the only way to differentiate between them is to look
     * for expected fields. There are no enums for push events subtypes.
     *
     * If an event is deemed not supported, we will return a success and print a message saying the event is not supported.
     */
    if (
      ["repository", "ref", "created", "deleted", "pusher"].some(
        (str) => !(str in body)
      )
    ) {
      console.log("Event is not supported");
      callback(null, {
        statusCode: 200,
        body: "Currently, this lambda does not support this event type from GitHub.",
      });
      return;
    }

    // A push has been made for some repository (ignore pushes that are deletes)
    if (!body.deleted) {
      console.log("Valid push event ", deliveryId);
      logPayloadToS3(githubEventType, body, deliveryId); //upload event to S3

      const repository = body.repository.full_name;
      const gitReference = body.ref;

      path += "workflows/github/release";

      postEndpoint(path, body, deliveryId, (response) => {
        const successMessage =
          "The associated entries on Dockstore for repository " +
          repository +
          " with version " +
          gitReference +
          " have been updated";
        handleCallback(response, successMessage, callback);
      });
    } else {
      console.log("Valid push event (delete) ", deliveryId);
      logPayloadToS3(githubEventType, body, deliveryId); //upload event to S3
      const repository = body.repository.full_name;
      const gitReference = body.ref;
      const username = body.sender.login;
      const installationId = body.installation.id;

      path += "workflows/github";

      deleteEndpoint(
        path,
        repository,
        gitReference,
        username,
        installationId,
        deliveryId,
        (response) => {
          const successMessage =
            "The associated versions on Dockstore for repository " +
            repository +
            " with version " +
            gitReference +
            " have been deleted";
          handleCallback(response, successMessage, callback);
        }
      );
    }
  } else if (githubEventType === "release") {
    handleReleaseEvent(githubEventType, body, deliveryId, path, callback);
  } else {
    console.log("Event " + githubEventType + " is not supported", deliveryId);
    callback(null, {
      statusCode: 200,
      body:
        "Currently, this lambda does not support the event type" +
        githubEventType +
        " from GitHub.",
    });
    return;
  }
}

function logPayloadToS3(eventType, body, deliveryId) {
  // If bucket name is not null (had to put this for the integration test)
  if (process.env.BUCKET_NAME) {
    const date = new Date();
    const uploadYear = date.getFullYear();
    const uploadMonth = (date.getMonth() + 1).toString().padStart(2, "0"); // ex. get 05 instead of 5 for May
    const uploadDate = date.getDate().toString().padStart(2, "0"); // ex. get 05 instead of 5 for the 5th date
    const uploadHour = date.getHours().toString().padStart(2, "0"); // ex. get 05 instead of 5 for the 5th hour
    const bucketPath = `${uploadYear}-${uploadMonth}-${uploadDate}/${uploadHour}/${deliveryId}`;

    const fullPayload = {};
    fullPayload["eventType"] = eventType;
    fullPayload["body"] = body;

    const command = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: bucketPath,
      Body: JSON.stringify(fullPayload),
      ContentType: "application/json",
    });
    try {
      const response = client.send(command);
      console.log(
        "Successfully uploaded payload to bucket. DeliveryID: ",
        deliveryId,
        response
      );
    } catch (err) {
      console.error(
        "Error uploading payload to bucket. DeliveryID: ",
        deliveryId,
        err
      );
    }
  }
}

// Handle response from Dockstore webservice
function handleCallback(response, successMessage, callback) {
  console.log(response);
  if (response.statusCode < 400) {
    console.info(successMessage);
    callback(null);
  } else if (response.statusCode < 500) {
    // Client error, don't retry
    console.info(
      `Error handling GitHub webhook, will not retry: ${response.statusCode} - ${response.statusMessage}`
    );
    callback(null);
  } else {
    // Server error, retry
    console.info("Server error, retrying call");
    callback({
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
    });
  }
}

module.exports.handler = (event, context, callback) => {
  processEvent(event, callback);
};
