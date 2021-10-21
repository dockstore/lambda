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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.dockstore.openapi.client.model.LanguageParsingRequest;
import io.dockstore.openapi.client.model.LanguageParsingResponse;
import java.net.HttpURLConnection;
import javax.ws.rs.core.MediaType;
import org.junit.jupiter.api.Test;

public class AppTest {

  @Test
  public void successfulResponse() throws Exception {
    LanguageParsingRequest request = new LanguageParsingRequest();
    request.setBranch("2.3");
    // Archived repository with tag that is unlikely to change
    request.setUri("https://github.com/SciLifeLab/Sarek.git");
    request.setDescriptorRelativePathInGit("nextflow.config");
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
    assertNotNull(response.getVersionTypeValidation().isValid());
    assertTrue(response.getVersionTypeValidation().isValid());
    assertNotNull(response.getClonedRepositoryAbsolutePath());
    assertTrue(response.getClonedRepositoryAbsolutePath().contains("clonedRepository"));
    assertNotNull(response.getSecondaryFilePaths());
    final int knownSecondaryFilesCount = 23;
    assertEquals(
        knownSecondaryFilesCount,
        response.getSecondaryFilePaths().size(),
        "Should be 4 bin files, 16 config files, 2 lib files, and main.nf");
    assertEquals("Sarek - Workflow For Somatic And Germline Variations", response.getDescription());
    System.out.println(response.getClonedRepositoryAbsolutePath());
    assertEquals("Szilvester Juhos, Maxime Garcia", response.getAuthor());
  }
}
