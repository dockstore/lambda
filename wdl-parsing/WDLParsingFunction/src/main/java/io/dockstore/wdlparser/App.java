package io.dockstore.wdlparser;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import cats.data.NonEmptyList;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import cromwell.languages.LanguageFactory;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.errors.GitAPIException;
import scala.collection.JavaConverters;
import scala.util.Either;
import wom.executable.WomBundle;

/**
 * Handler for requests to Lambda function.
 */
public class App implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {
    ObjectMapper mapper = new ObjectMapper();
    public APIGatewayProxyResponseEvent handleRequest(final APIGatewayProxyRequestEvent input, final Context context) {

        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "application/json");
        headers.put("X-Custom-Header", "application/json");

        APIGatewayProxyResponseEvent response = new APIGatewayProxyResponseEvent()
                .withHeaders(headers);
        if (input != null && input.getBody() != null) {
            try {
                Request request = mapper.readValue(input.getBody(), Request.class);
                try {
                    String s = parseWDLFile(request.getUri(), request.getBranch(), request.getDescriptorRelativePathInGit());
                    return response.withStatusCode(HttpURLConnection.HTTP_OK).withBody(s);
                } catch (IOException e) {
                    e.printStackTrace();
                    return response.withBody("Could not clone repository to temporary directory").withStatusCode(HttpURLConnection.HTTP_INTERNAL_ERROR);
                } catch (GitAPIException e) {
                    e.printStackTrace();
                    return response.withBody("Could not clone Git repository").withStatusCode(HttpURLConnection.HTTP_INTERNAL_ERROR);
                }
            } catch (JsonProcessingException e) {
                e.printStackTrace();
                return response.withBody("Could not process request").withStatusCode(HttpURLConnection.HTTP_BAD_REQUEST);
            }
        } else {
            return response.withBody("No body in request").withStatusCode(HttpURLConnection.HTTP_BAD_REQUEST);
        }
    }

    private String parseWDLFile(String uri, String branch, String descriptorRelativePathInGit) throws IOException, GitAPIException {
        Path tempDirWithPrefix = Files.createTempDirectory("clonedRepository");
        Git git = Git.cloneRepository().setURI(uri).setDirectory(tempDirWithPrefix.toFile()).call();
        git.checkout().setName(branch).call();
        WdlBridge wdlBridge = new WdlBridge();
        Path descriptorAbsolutePath = tempDirWithPrefix.resolve(descriptorRelativePathInGit);
        String descriptorAbsolutePathString = descriptorAbsolutePath.toString();
        String descriptorContents = Files.readString(descriptorAbsolutePath);
        LanguageFactory languageFactory = wdlBridge.getLanguageFactory(descriptorContents);
        List<LanguageFactory> languageFactories = Collections.singletonList(languageFactory);
        Either<NonEmptyList<String>, WomBundle> womBundle = languageFactory
                .getWomBundle(descriptorContents, getEmptyJSON(), wdlBridge.getImportResolvers(descriptorAbsolutePathString),
                        JavaConverters.asScalaBuffer(languageFactories).toList());
        Response response = new Response();
        if (womBundle.right().get().primaryCallable().isDefined()) {
            response.setValid(true);
        } else {
            response.setValid(false);
        }
        response.setClonedRepositoryAbsolutePath(descriptorAbsolutePathString);
        return mapper.writeValueAsString(response);
    }

    /**
     * This most complicated way of returning "{}"
     * @return
     * @throws JsonProcessingException
     */
    private String getEmptyJSON() throws JsonProcessingException {
        ObjectNode obj = mapper.createObjectNode();
        String s = mapper.writeValueAsString(obj);
        return s;
    }
}
