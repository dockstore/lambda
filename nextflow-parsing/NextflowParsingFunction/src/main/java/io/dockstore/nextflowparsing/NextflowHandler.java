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
import dockstore.openapi.client.model.SourceFile;
import dockstore.openapi.client.model.VersionTypeValidation;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.commons.configuration2.Configuration;
import org.apache.commons.io.FilenameUtils;

public class NextflowHandler {
  private String descriptorContents;
  private String descriptorTempAbsolutePath;
  private Configuration configuration;
  private VersionTypeValidation versionTypeValidation = new VersionTypeValidation();
  private List<String> secondaryDescriptorPaths;
  protected static final Pattern IMPORT_PATTERN = Pattern.compile("^\\s*include.+?from.+?'.+?'", Pattern.DOTALL | Pattern.MULTILINE);
  private static final Pattern INCLUDE_CONFIG_PATTERN = Pattern.compile("(?i)(?m)^[ \t]*includeConfig(.*)");

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

  public List<String> processImports(String content) {
    // FIXME: see{@link NextflowUtilities#grabConfig(String) grabConfig} method for comments on why

    // we have to look at imports in this crummy way
    final Matcher matcher = INCLUDE_CONFIG_PATTERN.matcher(content);
    Set<String> suspectedConfigImports = new HashSet<>();
    while (matcher.find()) {
      suspectedConfigImports.add(CharMatcher.is('\'').trimFrom(matcher.group(1).trim()));
    }
    List<String> imports = new ArrayList<>();
    Configuration configuration;
    try {
      configuration = NextflowUtilities.grabConfig(content);
    } catch (Exception e) {
      VersionTypeValidation versionTypeValidation = this.getVersionTypeValidation();
      versionTypeValidation.setValid(false);
      Map<String, String> messageMap = new HashMap<>();
      messageMap.put(this.getDescriptorTempAbsolutePath(), e.getMessage());
      versionTypeValidation.setMessage(messageMap);
      this.setVersionTypeValidation(versionTypeValidation);
      return imports;
    }

    // add the Nextflow scripts
    String mainScriptPath = "main.nf";
    if (configuration.containsKey("manifest.mainScript")) {
      mainScriptPath = configuration.getString("manifest.mainScript");
    }

    suspectedConfigImports.add(mainScriptPath);


    // source files in /lib seem to be automatically added to the script classpath
    // binaries are also there and will need to be ignored
//    List<String> strings = sourceCodeRepoInterface.listFiles(repositoryId, "/", version.getReference());
//    handleNextflowImports(repositoryId, version, sourceCodeRepoInterface, imports, strings, "lib");
//    handleNextflowImports(repositoryId, version, sourceCodeRepoInterface, imports, strings, "bin");
    imports.addAll(suspectedConfigImports);
    return imports;
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

  public void setVersionTypeValidation(
      VersionTypeValidation versionTypeValidation) {
    this.versionTypeValidation = versionTypeValidation;
  }

  public List<String> getSecondaryDescriptorPaths() {
    return secondaryDescriptorPaths;
  }

  public void setSecondaryDescriptorPaths(List<String> secondaryDescriptorPaths) {
    this.secondaryDescriptorPaths = secondaryDescriptorPaths;
  }
}
