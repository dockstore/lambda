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

import groovy.util.ConfigObject;
import java.io.File;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import nextflow.config.ConfigParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class NextflowUtilities {

  private static final Logger LOG = LoggerFactory.getLogger(NextflowUtilities.class);

  private NextflowUtilities() {
    // hide the default constructor for a utility class
  }

  /**
   * Get authors of the workflow.
   *
   * @param configuration The Nextflow configuration
   * @return
   */
  public static List<String> getAuthors(ConfigObject configuration) {
    try {
      Map manifest = (Map) configuration.get("manifest");
      String author = (String) manifest.get("author");
      String[] authors = Arrays.stream(author.split(",")).map(String::trim).toArray(String[]::new);
      return Arrays.asList(authors);
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * Get the description of the workflow.
   *
   * @param configuration The Nextflow configuration
   * @return
   */
  public static String getDescription(ConfigObject configuration) {
    try {
      Map manifest = (Map) configuration.get("manifest");
      return (String) manifest.get("description");
    } catch (Exception e) {
      return null;
    }
  }

  public static ConfigObject getConfig(File tempMainDescriptor) {
    ConfigParser configParser = new ConfigParser();
    return configParser.parse(tempMainDescriptor);
  }
}
