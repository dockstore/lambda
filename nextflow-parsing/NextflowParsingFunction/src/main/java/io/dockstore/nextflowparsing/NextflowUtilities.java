/*
 *    Copyright 2019 OICR
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

package io.dockstore.nextflowparsing;

import java.io.File;
import java.io.IOException;
import java.io.StringReader;
import java.net.MalformedURLException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.Properties;
import org.apache.commons.configuration2.Configuration;
import org.apache.commons.configuration2.ConfigurationConverter;
import org.apache.commons.configuration2.INIConfiguration;
import org.apache.commons.io.FileUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class NextflowUtilities {

  private static final Logger LOG = LoggerFactory.getLogger(NextflowUtilities.class);
  private static final String DEFAULT_NEXTFLOW_VERSION = "20.07.1";
  // based on webservice logs, usually <6 seconds is needed
  private static final long TIMEOUT_MILLISECONDS = 15000;

  private NextflowUtilities() {
    // hide the default constructor for a utility class
  }

  public static File getNextflowTargetFile(INIConfiguration config) {
    String nextflowVersion = config.getString("nextflow-version", DEFAULT_NEXTFLOW_VERSION);
    return getNextflowTargetFile(nextflowVersion);
  }

  private static File getNextflowTargetFile() {
    return getNextflowTargetFile(DEFAULT_NEXTFLOW_VERSION);
  }

  private static File getNextflowTargetFile(String nextflowVersion) {
    String nextflowExec =
        "https://github.com/nextflow-io/nextflow/releases/download/v"
            + nextflowVersion
            + "/nextflow-"
            + nextflowVersion
            + "-all";
    if (!Objects.equals(DEFAULT_NEXTFLOW_VERSION, nextflowVersion)) {
      System.out.println(
          "Running with Nextflow "
              + nextflowVersion
              + " , Dockstore tests with "
              + DEFAULT_NEXTFLOW_VERSION);
    }

    // grab the nextflow jar if needed
    String libraryLocation =
        System.getProperty("user.home")
            + File.separator
            + ".dockstore"
            + File.separator
            + "libraries"
            + File.separator;
    URL nextflowUrl;
    String nextflowFilename;
    try {
      nextflowUrl = new URL(nextflowExec);
      nextflowFilename = new File(nextflowUrl.toURI().getPath()).getName();
    } catch (MalformedURLException | URISyntaxException e) {
      throw new NextflowParsingException("Could not create Nextflow location", e);
    }
    String nextflowTarget = libraryLocation + nextflowFilename;
    File nextflowTargetFile = new File(nextflowTarget);
    if (!nextflowTargetFile.exists()) {
      try {
        FileUtils.copyURLToFile(nextflowUrl, nextflowTargetFile);
      } catch (IOException e) {
        throw new NextflowParsingException("Could not download Nextflow location", e);
      }
    }
    return nextflowTargetFile;
  }

  /**
   * Use nextflow to read nextflow configs Nextflow binary assumes workflow is in the working
   * directory (with no other workflows) TODO: nextflow normally uses DRIP, investigate to see if
   * this helps us https://github.com/ninjudd/drip
   *
   * @param content a file object with the content of nextflow
   * @return a commons configuration file with the keys from the nextflow config file
   */
  public static Configuration grabConfig(File content) {
    try {
      final List<String> strings =
          Arrays.asList(
              "java", "-jar", getNextflowTargetFile().getAbsolutePath(), "config", "-properties");
      String stdout = executeNextflowConfig(content.getParentFile(), strings);
      Properties properties = new Properties();
      properties.load(new StringReader(stdout));
      return ConfigurationConverter.getConfiguration(properties);
    } catch (RuntimeException | IOException | InterruptedException e) {
      LOG.error("Problem running Nextflow: ", e);
      throw new NextflowParsingException("Could not run Nextflow", e);
    }
  }

  public static List<String> getAuthors(Configuration configuration) {
    List<String> authorsList = new ArrayList<>();
    if (configuration.containsKey("manifest.author")) {
      String[] authors = configuration.getString("manifest.author").split(",");
      authorsList = Arrays.asList(authors);
    }
    return authorsList;
  }

  public static String getDescription(Configuration configuration) {
    if (configuration.containsKey("manifest.description")) {
      return configuration.getString("manifest.description");
    } else {
      return null;
    }
  }

  /**
   * Converts the contents of a config file to a commons config file.
   *
   * @param content the content of the config file
   * @return a commons configuration file with the keys from the nextflow config file
   */
  public static Configuration grabConfig(String content) {
    Path nextflowDir = null;
    try {
      // FIXME: this sucks, but we need to ignore includeConfig lines.
      //  We basically have a chicken and the egg problem
      // FIXME: the nextflow config command only works when all included files are present,
      //  however we're trying to use the nextflow config command to figure out what the list of
      //  included files is to determine what files we want to get from the GitHub API in the first
      //  place
      // FIXME: secondary case: when looking for description and author,
      //  we don't actually need includes either
      String newContent = content.replaceAll("(?i)(?m)^[ \t]*includeConfig.*", "");
      // needed since Nextflow binary assumes content is in working directory
      nextflowDir = Files.createTempDirectory("nextflow");
      final Path tempFile = Paths.get(nextflowDir.toString(), "nextflow.config");
      Files.write(tempFile, newContent.getBytes(StandardCharsets.UTF_8));
      return grabConfig(tempFile.toFile());
    } catch (IOException e) {
      throw new NextflowParsingException("unable to parse nexflow config");
    } finally {
      if (nextflowDir != null) {
        FileUtils.deleteQuietly(nextflowDir.toFile());
      }
    }
  }

  /**
   * This is an expensive operation; a new Java VM is spun up for this, so only allow one at a time
   * by synchronizing the method.
   *
   * @param directory the directory to execute the command
   * @param commands the command
   * @return nothing
   */
  private static synchronized String executeNextflowConfig(File directory, List<String> commands)
      throws InterruptedException, IOException {
    ProcessBuilder builder = new ProcessBuilder();
    builder.command(commands);
    builder.directory(directory);
    Process process = builder.start();
    String text = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    int exitCode = process.waitFor();
    if (exitCode == 0) {
      return text;
    } else {
      return null;
    }
  }

  /** Runtime exception for Nextflow integration issues. */
  public static class NextflowParsingException extends RuntimeException {

    NextflowParsingException(String message) {
      super(message);
    }

    NextflowParsingException(String message, Throwable e) {
      super(message, e);
    }
  }
}
