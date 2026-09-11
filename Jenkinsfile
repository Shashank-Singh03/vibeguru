// Jenkinsfile — CI for the Vibe Guru engine, and a worked example of the thing it sells.
//
// Two jobs in one file, deliberately:
//
//   Stages 1-4 build and verify the engine itself (format, compile, test, escript).
//   Stage  5   turns the engine on the bundled test app and gates the build on the
//              result — which is exactly the pipeline a *user* of Vibe Guru writes.
//
// If you are here to integrate Vibe Guru into your own Jenkins, you do not need any
// of the Elixir stages. Skip to "REFERENCE INTEGRATION" at the bottom of this file:
// it is about fifteen lines and needs nothing but Node on the agent.
//
// Prerequisites on the agent for the engine stages:
//   * Elixir 1.18+ and Erlang/OTP 27+ on PATH
//   * Node 18+ on PATH
//   * driver-node dependencies installed (the pipeline does this, including Chromium)
//   * the "Pipeline Utility Steps" plugin, for readJSON in the fixture-check stage.
//     Without it that stage fails with "No such DSL method 'readJSON'" — the reference
//     integration at the bottom of this file needs no plugins at all.

pipeline {
  agent any

  options {
    timestamps()
    // A browser-driven analysis run is the long pole; without a cap a hung
    // headless Chrome would occupy the executor indefinitely.
    timeout(time: 30, unit: 'MINUTES')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '30'))
  }

  parameters {
    booleanParam(
      name: 'FAIL_ON_FINDINGS',
      defaultValue: true,
      description: 'Fail the build when the analysis reports high/critical findings. ' +
                   'Set false to observe for a few builds before enforcing.'
    )
    string(
      name: 'CYCLES',
      defaultValue: '6',
      description: 'Mount/unmount cycles per route. More cycles = stronger signal, longer run.'
    )
  }

  environment {
    MIX_ENV = 'test'
    // Keep Hex/Rebar caches inside the workspace so agents stay stateless and two
    // concurrent jobs cannot corrupt a shared ~/.hex.
    MIX_HOME = "${WORKSPACE}/.mix"
    HEX_HOME = "${WORKSPACE}/.hex"
    // Playwright downloads Chromium here; caching it across builds saves ~150MB
    // of download per run.
    PLAYWRIGHT_BROWSERS_PATH = "${WORKSPACE}/.playwright"
  }

  stages {
    stage('Toolchain') {
      steps {
        sh '''
          set -eu
          echo "elixir : $(elixir --version | tr '\\n' ' ')"
          echo "node   : $(node --version)"
          mix local.hex --force --if-missing
          mix local.rebar --force --if-missing
        '''
      }
    }

    stage('Dependencies') {
      steps {
        sh 'mix deps.get --check-locked'
        // Root package: the npx wrapper and the MCP server.
        sh 'npm ci --ignore-scripts'
        // The browser driver and its Chromium. `npm ci` needs the lockfile, which is
        // committed, so this is reproducible.
        dir('driver-node') {
          sh 'npm ci && npx playwright install --with-deps chromium'
        }
      }
    }

    stage('Static checks') {
      // These are independent, so a formatting nit and a compile warning both get
      // reported in one build instead of one-per-push.
      parallel {
        stage('Format') {
          steps { sh 'mix format --check-formatted' }
        }
        stage('Compile') {
          steps { sh 'mix compile --warnings-as-errors' }
        }
      }
    }

    stage('Test') {
      // Two suites, two languages: the analyzers in Elixir, the MCP server and its
      // rendering in Node. Run in parallel — neither touches the other's files.
      parallel {
        stage('Elixir') {
          steps { sh 'mix test' }
        }
        stage('Node') {
          steps { sh 'npm test' }
        }
      }
    }

    stage('Build escript') {
      steps {
        sh 'MIX_ENV=dev mix escript.build'
        archiveArtifacts artifacts: 'vibeguru', fingerprint: true
      }
    }

    // ---------------------------------------------------------------------
    // Dogfood: run the analyzer against the bundled test app.
    //
    // test-app is deliberately broken — every fixture route isolates one signature,
    // and /clean is the control. So this stage is a real assertion about the engine:
    // if the findings disappear, the engine regressed; if /clean starts producing
    // findings, it began false-firing. Either is a build failure.
    // ---------------------------------------------------------------------
    stage('Analyze test-app') {
      steps {
        dir('test-app') {
          sh 'npm ci'
        }
        script {
          // The CLI exits 1 when high/critical findings exist. That is the product's
          // CI contract, so here we capture it rather than let it abort the stage.
          env.VG_STATUS = sh(
            returnStatus: true,
            script: """
              set -eu
              ./vibeguru init --root test-app
              ./vibeguru run  --root test-app --out reports --cycles ${params.CYCLES} --routes 14
            """
          ).toString()
          echo "vibeguru exit status: ${env.VG_STATUS}"
        }
      }
      post {
        always {
          archiveArtifacts(
            artifacts: 'reports/**',
            allowEmptyArchive: true,
            fingerprint: true
          )
        }
      }
    }

    stage('Verify fixtures still detected') {
      steps {
        // The expectations live in scripts/verify-fixtures.mjs, not here. Two CI
        // systems check this repo, and duplicating the assertions in Groovy and in a
        // workflow guarantees they drift — with the drifted one quietly asserting
        // less than you think.
        sh 'node scripts/verify-fixtures.mjs reports/vibeguru-findings.json'
      }
    }

    stage('Quality gate') {
      when { expression { params.FAIL_ON_FINDINGS } }
      steps {
        script {
          // Exit 1 means high/critical findings were reported. For THIS repo that is
          // expected (test-app is broken on purpose) and the stage above already
          // asserted the right ones — so we only fail on a genuine run error (2/64).
          if (env.VG_STATUS == '2' || env.VG_STATUS == '64') {
            error "vibeguru failed to run (exit ${env.VG_STATUS})"
          }
        }
      }
    }
  }

  post {
    success { echo 'Engine verified: fixtures detected, control route clean.' }
    failure { echo 'Build failed — check the archived reports/ for the findings JSON.' }
    cleanup { cleanWs(deleteDirs: true, notFailBuild: true) }
  }
}

// =====================================================================
// REFERENCE INTEGRATION — copy this into YOUR Jenkinsfile
// =====================================================================
//
// This is the whole thing. No Elixir, no toolchain: `npx vibeguru` pulls a
// self-contained binary for the agent's OS and fetches Chromium on first use.
//
//   stage('Runtime analysis') {
//     steps {
//       // `run` starts your dev server if it is not already up, exercises every
//       // route it can reach, and writes CLAUDE.md + reports to --out.
//       sh 'npx --yes vibeguru init'
//       sh 'npx --yes vibeguru run --out reports --cycles 6'
//     }
//     post {
//       always {
//         archiveArtifacts artifacts: 'reports/**', allowEmptyArchive: true
//       }
//     }
//   }
//
// The command exits non-zero when high/critical findings exist, so the stage fails
// the build with no extra wiring. Two notes from experience:
//
//   * Start with `catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE')` around
//     it for the first few builds. Turning a brand-new gate straight to blocking on a
//     codebase nobody has analyzed before is how quality gates get switched off for
//     good in week two.
//   * reports/CLAUDE.md is the file to hand to a coding agent. Archiving it means a
//     developer can pull one artifact and say "fix these" without reproducing the run.
