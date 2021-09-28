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
import io.dockstore.openapi.client.model.LanguageParsingRequest;
import io.dockstore.openapi.client.model.LanguageParsingResponse;
import io.dockstore.openapi.client.model.VersionTypeValidation;
import java.io.File;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.nio.file.Files;
import java.nio.file.Path;
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
   * Get a language parsing response from NextflowHandler.
   *
   * @param nextflowHandler NextflowHandler that contains all relevant Nextflow information
   * @return LanguageParsingResponse constructed after getting information from NextflowHandler
   */
  public static LanguageParsingResponse getResponse(NextflowHandler nextflowHandler) {
    LanguageParsingResponse response = new LanguageParsingResponse();
    String descriptorAbsolutePathString = nextflowHandler.getDescriptorTempAbsolutePath();
    response.setClonedRepositoryAbsolutePath(descriptorAbsolutePathString);
    VersionTypeValidation versionTypeValidation = nextflowHandler.getVersionTypeValidation();
    if (nextflowHandler.getDescriptorContents() == null) {
      versionTypeValidation.setValid(false);
      Map<String, String> messageMap = new HashMap<>();
      // TODO: Don't use temp absolute path
      messageMap.put(nextflowHandler.getDescriptorTempAbsolutePath(), "File not found");
      versionTypeValidation.setMessage(messageMap);
    }
    if (nextflowHandler.getConfiguration() == null) {
      versionTypeValidation.setValid(false);
    }
    // TODO: This should be an array, don't join
    response.setAuthor(
        String.join(", ", NextflowUtilities.getAuthors(nextflowHandler.getConfiguration())));
    response.setDescription(NextflowUtilities.getDescription(nextflowHandler.getConfiguration()));
    versionTypeValidation.setValid(true);
    response.setVersionTypeValidation(versionTypeValidation);
    response.setSecondaryFilePaths(nextflowHandler.getSecondaryDescriptorPaths());
    return response;
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
              parseFile(
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

  private String parseFile(
      LanguageParsingRequest languageParsingRequest)
      throws IOException, GitAPIException {
    Path tempDirWithPrefix = Files.createTempDirectory("clonedRepository");
    Git.cloneRepository()
        .setCloneAllBranches(false)
        .setBranch(languageParsingRequest.getBranch())
        .setURI(languageParsingRequest.getUri())
        .setDirectory(tempDirWithPrefix.toFile())
        .call();
     Path descriptorAbsolutePath = tempDirWithPrefix.resolve(
         languageParsingRequest.getDescriptorRelativePathInGit());
    String descriptorAbsolutePathString = descriptorAbsolutePath.toString();
    NextflowHandler nextflowHandler = new NextflowHandler();
    nextflowHandler.setDescriptorTempAbsolutePath(descriptorAbsolutePathString);
    nextflowHandler.setConfiguration(
        NextflowUtilities.getConfig(new File(descriptorAbsolutePathString)));
    try {
      String s = Files.readString(Path.of(descriptorAbsolutePathString));

      nextflowHandler.setDescriptorContents(s);
      List<String> strings =
          nextflowHandler.processImports(nextflowHandler.getDescriptorContents());
      nextflowHandler.setSecondaryDescriptorPaths(strings);
    } catch (IOException e) {
      LOGGER.error(e.getMessage());
      nextflowHandler.setDescriptorContents(null);
    }
    LanguageParsingResponse response = getResponse(nextflowHandler);
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
