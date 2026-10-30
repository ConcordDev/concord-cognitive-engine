// concord-jetbrains/build.gradle.kts
//
// IntelliJ Platform plugin. Consumes the concord-lsp via LSP4IJ
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
  // LSP4IJ is an IDE plugin, not a Maven artifact: the intellij { plugins }
  // entry above puts its classes on the compile classpath, and the IDE
  // supplies them at runtime via <depends> in plugin.xml.
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

  // Bundle the compiled concord-lsp at the plugin root as lsp/, where
  // ConcordLanguageServer looks for it (<pluginPath>/lsp/server.js).
  // Prerequisite: build the server first —
  //   npm --prefix ../concord-lsp ci && npm --prefix ../concord-lsp run compile
  // Without out/ + node_modules the copy specs below silently match
  // nothing and the LSP start fails visibly in the LSP4IJ console;
  // the doFirst warning names the missing prerequisite at build time.
  withType<org.jetbrains.intellij.tasks.PrepareSandboxTask>().configureEach {
    doFirst {
      if (!file("../concord-lsp/out/server.js").exists()) {
        logger.warn(
          "concord-lsp is not compiled (../concord-lsp/out/server.js missing): " +
            "the plugin will bundle no language server. Run " +
            "`npm --prefix ../concord-lsp ci && npm --prefix ../concord-lsp run compile` first."
        )
      }
    }
    // The sandbox root is plugins/, so nest under the plugin's own directory:
    // <pluginName>/lsp/server.js is what the built zip and the runtime see.
    from("../concord-lsp/out") { into(pluginName.map { "$it/lsp" }) }
    from("../concord-lsp/node_modules") { into(pluginName.map { "$it/lsp/node_modules" }) }
  }
}
