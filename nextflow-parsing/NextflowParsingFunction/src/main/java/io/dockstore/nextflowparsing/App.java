/*
 * Copyright 2021 OICR and UCSC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package io.dockstore.nextflowparsing;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import dockstore.openapi.client.model.LanguageParsingRequest;
import dockstore.openapi.client.model.LanguageParsingResponse;
import dockstore.openapi.client.model.VersionTypeValidation;
import java.io.File;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.ws.rs.core.MediaType;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Handler for requests to Lambda function. */
public class App
    implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {

  private static final Logger LOGGER = LoggerFactory.getLogger(App.class);
  ObjectMapper mapper = new ObjectMapper();

  /**
   * Get a language parsing response by running womtool.
   *
   * @param descriptorAbsolutePathString Absolute path to the main descriptor file
   * @return LanguageParsingResponse constructed after running womtool
   */
  public static LanguageParsingResponse getResponse(String descriptorAbsolutePathString) {
    LanguageParsingResponse response = new LanguageParsingResponse();
    response.setClonedRepositoryAbsolutePath(descriptorAbsolutePathString);
    try {
      List<String> strings = new ArrayList<>();

      // The first two lines aren't actual paths.
      VersionTypeValidation versionTypeValidation = new VersionTypeValidation();
      if (strings.get(0).equals("Success!")
          && strings.get(1).equals("List of Workflow dependencies is:")) {
        versionTypeValidation.setValid(true);
        response.setVersionTypeValidation(versionTypeValidation);
        handleSuccessResponse(response, strings);
      } else {
        versionTypeValidation.setValid(false);
        Map<String, String> messageMap = new HashMap<>();
        // TODO: Using the main descriptor path as the key until we figure out how to get the actual
        //  file that has the error
        messageMap.put(descriptorAbsolutePathString, "Placeholder");
        versionTypeValidation.setMessage(messageMap);
        response.setVersionTypeValidation(versionTypeValidation);
      }
      return response;
    } catch (StackOverflowError e) {
      VersionTypeValidation versionTypeValidation = new VersionTypeValidation();
      versionTypeValidation.setValid(false);
      Map<String, String> messageMap = new HashMap<>();
      // TODO: Using the main descriptor path as the key until we figure out how to get the actual
      //  file that has the error
      messageMap.put(descriptorAbsolutePathString, "Encountered recursive imports");
      versionTypeValidation.setMessage(messageMap);
      response.setVersionTypeValidation(versionTypeValidation);
      return response;
    }
  }

  // The first two lines aren't actual paths.
  // It looks like "Success!" and "List of Workflow dependencies is:"
  private static void handleSuccessResponse(
      LanguageParsingResponse response, List<String> strings) {
    strings.remove(0);
    strings.remove(0);
    // If there are no imports, womtool says None
    if (strings.get(0).equals("None")) {
      strings.remove(0);
    }
    response.setSecondaryFilePaths(strings);
  }

  @Override
  public APIGatewayProxyResponseEvent handleRequest(
      final APIGatewayProxyRequestEvent input, final Context context) {

    Map<String, String> headers = new HashMap<>();
    headers.put("Content-Type", MediaType.APPLICATION_JSON);

    APIGatewayProxyResponseEvent response = new APIGatewayProxyResponseEvent().withHeaders(headers);
    if (input != null && input.getBody() != null) {
      try {
        LanguageParsingRequest request =
            mapper.readValue(input.getBody(), LanguageParsingRequest.class);
        try {
          String s =
              parseWdlFile(
                  request.getUri(),
                  request.getBranch(),
                  request.getDescriptorRelativePathInGit(),
                  request);
          return response.withStatusCode(HttpURLConnection.HTTP_OK).withBody(s);
        } catch (IOException e) {
          String errorMessage = "Could not clone repository to temporary directory";
          LOGGER.error(errorMessage, e);
          return response
              .withBody(errorMessage)
              .withStatusCode(HttpURLConnection.HTTP_INTERNAL_ERROR);
        } catch (GitAPIException e) {
          StringWriter sw = new StringWriter();
          e.printStackTrace(new PrintWriter(sw));
          String exceptionAsString = sw.toString();
          return response
              .withBody(exceptionAsString)
              .withStatusCode(HttpURLConnection.HTTP_INTERNAL_ERROR);
        }
      } catch (IOException e) {
        String errorMessage = "Could not process request";
        LOGGER.error(errorMessage, e);
        return response.withBody(errorMessage).withStatusCode(HttpURLConnection.HTTP_BAD_REQUEST);
      }
    } else {
      return response
          .withBody("No body in request")
          .withStatusCode(HttpURLConnection.HTTP_BAD_REQUEST);
    }
  }

  private String parseWdlFile(
      String uri,
      String branch,
      String descriptorRelativePathInGit,
      LanguageParsingRequest languageParsingRequest)
      throws IOException, GitAPIException {
    Path tempDirWithPrefix = Files.createTempDirectory("clonedRepository");
    Git.cloneRepository()
        .setCloneAllBranches(false)
        .setBranch(branch)
        .setURI(uri)
        .setDirectory(tempDirWithPrefix.toFile())
        .call();
    Path descriptorAbsolutePath = tempDirWithPrefix.resolve(descriptorRelativePathInGit);
    String descriptorAbsolutePathString = descriptorAbsolutePath.toString();
    LanguageParsingResponse response = getResponse(descriptorAbsolutePathString);
    response.setLanguageParsingRequest(languageParsingRequest);
    // Deleting a directory without Common IO
    Files.walk(tempDirWithPrefix)
        .sorted(Comparator.reverseOrder())
        .map(Path::toFile)
        .forEach(File::delete);
    if (response.getSecondaryFilePaths() != null) {
      response
          .getSecondaryFilePaths()
          .replaceAll(s -> s.replaceFirst(tempDirWithPrefix.toString(), ""));
    }
    return mapper.writeValueAsString(response);
  }
}
