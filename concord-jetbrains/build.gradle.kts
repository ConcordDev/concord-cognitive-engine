// concord-jetbrains/build.gradle.kts
//
// IntelliJ Platform plugin scaffold. Consumes the concord-lsp via LSP4IJ
// so VS Code, JetBrains, and the web-editor variant all run identical
// behaviour. Stays a thin shell — UI affordances + LSP wiring only.

plugins {
  id("java")
  id("org.jetbrains.kotlin.jvm") version "1.9.22"
  id("org.jetbrains.intellij") version "1.17.2"
}

group = "ai.concord"
version = "0.1.0"

repositories { mavenCentral() }

intellij {
  version.set("2024.1")
  type.set("IC")
  plugins.set(listOf(
    "com.redhat.devtools.lsp4ij:0.5.0"
  ))
}

dependencies {
  implementation("com.redhat.devtools.lsp4ij:lsp4ij:0.5.0") {
    isTransitive = false
  }
  // org.json — used by ConcordSettingsConfigurable + ConcordSignInAction
  // for JSON parse/serialize in the OAuth loopback callback.
  implementation("org.json:json:20231013")
}

kotlin {
  jvmToolchain(17)
}

tasks {
  patchPluginXml {
    sinceBuild.set("241")
    untilBuild.set("242.*")
  }
}
