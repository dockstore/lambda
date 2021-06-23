/*
 * Copyright 2021 OICR and UCSC
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

package io.dockstore.wdlparser;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import dockstore.openapi.client.model.LanguageParsingRequest;
import dockstore.openapi.client.model.LanguageParsingResponse;
import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import javax.ws.rs.core.MediaType;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

public class AppTest {
  @Test
  public void successfulResponse() throws IOException {
    LanguageParsingRequest request = new LanguageParsingRequest();
    request.setBranch("1.0.4");
    request.setUri("https://github.com/briandoconnor/dockstore-tool-md5sum.git");
    request.setDescriptorRelativePathInGit("Dockstore.wdl");
    App app = new App();
    APIGatewayProxyRequestEvent requestEvent = new APIGatewayProxyRequestEvent();
    ObjectMapper objectMapper = new ObjectMapper();
    requestEvent.setBody(objectMapper.writeValueAsString(request));
    APIGatewayProxyResponseEvent result = app.handleRequest(requestEvent, null);
    System.out.println(result.getBody());
    assertEquals(HttpURLConnection.HTTP_OK, result.getStatusCode().intValue());
    assertEquals(MediaType.APPLICATION_JSON, result.getHeaders().get("Content-Type"));
    String content = result.getBody();
    assertNotNull(content);
    LanguageParsingResponse response =
        objectMapper.readValue(content, LanguageParsingResponse.class);
    assertNotNull(response.getVersionTypeValidation());
    assertNotNull(response.getVersionTypeValidation().getValid());
    assertTrue(response.getVersionTypeValidation().getValid());
    assertNotNull(response.getClonedRepositoryAbsolutePath());
    assertTrue(response.getClonedRepositoryAbsolutePath().contains("/tmp"));
    assertNotNull(response.getSecondaryFilePaths());
    assertEquals(0, response.getSecondaryFilePaths().size());
    System.out.println(response.getClonedRepositoryAbsolutePath());
  }

  @Test
  public void successfulResponseOfComplexWorkflow() throws IOException {
    LanguageParsingRequest request = new LanguageParsingRequest();
    request.setBranch("dockstore-test");
    request.setUri("https://github.com/dockstore-testing/gatk-sv-clinical.git");
    request.setDescriptorRelativePathInGit("GATKSVPipelineClinical.wdl");
    App app = new App();
    APIGatewayProxyRequestEvent requestEvent = new APIGatewayProxyRequestEvent();
    ObjectMapper objectMapper = new ObjectMapper();
    requestEvent.setBody(objectMapper.writeValueAsString(request));
    APIGatewayProxyResponseEvent result = app.handleRequest(requestEvent, null);
    System.out.println(result.getBody());
    assertEquals(HttpURLConnection.HTTP_OK, result.getStatusCode().intValue());
    assertEquals(MediaType.APPLICATION_JSON, result.getHeaders().get("Content-Type"));
    String content = result.getBody();
    assertNotNull(content);
    LanguageParsingResponse response =
        objectMapper.readValue(content, LanguageParsingResponse.class);
    assertNotNull(response.getVersionTypeValidation());
    assertNotNull(response.getVersionTypeValidation().getValid());
    assertTrue(response.getVersionTypeValidation().getValid());
    assertNotNull(response.getClonedRepositoryAbsolutePath());
    assertTrue(response.getClonedRepositoryAbsolutePath().contains("/tmp"));
    assertNotNull(response.getSecondaryFilePaths());
    assertFalse(
        response.getSecondaryFilePaths().contains("GATKSVPipelineClinical.wdl"),
        "Main descriptor isn't a secondary file path");
    final long expectedNumberOfFiles = 76;
    assertEquals(expectedNumberOfFiles, response.getSecondaryFilePaths().size());
    System.out.println(response.getClonedRepositoryAbsolutePath());
  }

  /** Tests the case where the WDL is malformed and recursively imports itself. */
  @Disabled("Too dangerous test to run, also flakey")
  @Test
  public void testRecursiveWdl() {
    File file = new File("src/test/resources/recursive.wdl");
    String path = file.getAbsolutePath();
    LanguageParsingResponse response = App.getResponse(path);
    assertNotNull(response.getVersionTypeValidation());
    assertNotNull(response.getVersionTypeValidation().getValid());
    assertFalse(
        response.getVersionTypeValidation().getValid(),
        "A workflow that has recursive HTTP imports is invalid");
  }
}
