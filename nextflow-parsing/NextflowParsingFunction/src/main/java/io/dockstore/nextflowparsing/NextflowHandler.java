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

import com.google.common.base.CharMatcher;
import dockstore.openapi.client.model.VersionTypeValidation;
import java.io.File;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.apache.commons.configuration2.Configuration;

public class NextflowHandler {

  private String descriptorContents;
  private String descriptorTempAbsolutePath;
  private Configuration configuration;
  private VersionTypeValidation versionTypeValidation = new VersionTypeValidation();
  private List<String> secondaryDescriptorPaths;
  protected static final Pattern IMPORT_PATTERN =
      Pattern.compile("^\\s*include.+?from.+?'.+?'", Pattern.DOTALL | Pattern.MULTILINE);
  private static final Pattern INCLUDE_CONFIG_PATTERN =
      Pattern.compile("(?i)(?m)^[ \t]*includeConfig(.*)");

  public String getDescriptorTempAbsolutePath() {
    return descriptorTempAbsolutePath;
  }

  public void setDescriptorTempAbsolutePath(String descriptorTempAbsolutePath) {
    this.descriptorTempAbsolutePath = descriptorTempAbsolutePath;
  }

  public String getDescriptorContents() {
    return descriptorContents;
  }

  public void setDescriptorContents(String descriptorContents) {
    this.descriptorContents = descriptorContents;
  }

  /**
   * Get the relative path imports of the workflow.
   *
   * @param content The contents of the main descriptor file
   * @return
   */
  public List<String> processImports(String content) {
    // FIXME: see{@link NextflowUtilities#grabConfig(String) grabConfig} method for comments on why

    // we have to look at imports in this crummy way
    final Matcher matcher = INCLUDE_CONFIG_PATTERN.matcher(content);
    Set<String> suspectedConfigImports = new HashSet<>();
    while (matcher.find()) {
      suspectedConfigImports.add(CharMatcher.is('\'').trimFrom(matcher.group(1).trim()));
    }
    List<String> imports = new ArrayList<>();
    try {
      configuration = NextflowUtilities.grabConfig(content);
    } catch (Exception e) {
      VersionTypeValidation newVersionTypeValidation = this.getVersionTypeValidation();
      newVersionTypeValidation.setValid(false);
      Map<String, String> messageMap = new HashMap<>();
      messageMap.put(this.getDescriptorTempAbsolutePath(), e.getMessage());
      newVersionTypeValidation.setMessage(messageMap);
      this.setVersionTypeValidation(newVersionTypeValidation);
      return imports;
    }

    // add the Nextflow scripts
    String mainScriptPath = "main.nf";
    if (configuration.containsKey("manifest.mainScript")) {
      mainScriptPath = configuration.getString("manifest.mainScript");
    }

    suspectedConfigImports.add(mainScriptPath);
    imports.addAll(handleNextflowImports("bin"));
    imports.addAll(handleNextflowImports("lib"));
    imports.addAll(suspectedConfigImports);
    return imports;
  }

  /**
   * Get relative file paths from directory.
   *
   * @param directory The directory to get files from
   * @return List of files relative to the main descriptor file
   */
  private List<String> handleNextflowImports(String directory) {
    File binDirectory = Paths.get(descriptorTempAbsolutePath).resolveSibling(directory).toFile();
    List<String> binFiles = new ArrayList<>();
    String[] binFileNames =
        binDirectory.list((current, name) -> !(new File(current, name).isDirectory()));
    if (binFileNames != null) {
      List<String> binFileNamesList = List.of(binFileNames);
      binFiles =
          binFileNamesList.stream()
              .map(string -> directory + "/" + string)
              .collect(Collectors.toList());
    }
    return binFiles;
  }

  public Configuration getConfiguration() {
    return configuration;
  }

  public void setConfiguration(Configuration configuration) {
    this.configuration = configuration;
  }

  public VersionTypeValidation getVersionTypeValidation() {
    return this.versionTypeValidation;
  }

  public void setVersionTypeValidation(VersionTypeValidation versionTypeValidation) {
    this.versionTypeValidation = versionTypeValidation;
  }

  public List<String> getSecondaryDescriptorPaths() {
    return secondaryDescriptorPaths;
  }

  public void setSecondaryDescriptorPaths(List<String> secondaryDescriptorPaths) {
    this.secondaryDescriptorPaths = secondaryDescriptorPaths;
  }
}
