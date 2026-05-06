import { beforeEach, describe, expect, mock, test } from "bun:test"

const configMessages: string[] = []
const dispatchedEvents: string[] = []
const loadProviderDirectories: Array<string | undefined> = []
const loadAgentOptions: Array<{ directory?: string; force?: boolean } | undefined> = []
const savedWindow = globalThis.window

mock.module("@/lib/opencode/client", () => ({
  opencodeClient: {
    checkHealth: () => Promise.resolve(true),
    getBaseUrl: () => "/api",
    getDirectory: () => "/test/project",
    listAgents: () => Promise.resolve([]),
    withDirectory: (_directory: string | null | undefined, fn: () => Promise<unknown>) => fn(),
  },
}))

mock.module("@/lib/configSync", () => ({
  emitConfigChange: () => {},
  scopeMatches: () => false,
  subscribeToConfigChanges: () => () => {},
}))

mock.module("@/lib/configUpdate", () => ({
  startConfigUpdate: (message: string) => {
    configMessages.push(message)
  },
  finishConfigUpdate: () => {
    configMessages.push("finished")
  },
  updateConfigUpdateMessage: (message: string) => {
    configMessages.push(message)
  },
}))

mock.module("@/stores/useConfigStore", () => ({
  useConfigStore: {
    getState: () => ({
      invalidateModelMetadataCache: () => {},
      loadProviders: ({ directory }: { directory?: string } = {}) => {
        loadProviderDirectories.push(directory)
        return Promise.resolve(true)
      },
      loadAgents: (options?: { directory?: string; force?: boolean }) => {
        loadAgentOptions.push(options)
        return Promise.resolve(true)
      },
    }),
  },
}))

mock.module("@/stores/useCommandsStore", () => ({
  useCommandsStore: {
    getState: () => ({
      loadCommands: () => Promise.resolve(true),
    }),
  },
}))

mock.module("@/stores/useProjectsStore", () => ({
  useProjectsStore: {
    getState: () => ({
      projects: [],
      getActiveProject: () => null,
    }),
  },
}))

mock.module("@/stores/useSkillsCatalogStore", () => ({
  useSkillsCatalogStore: {
    getState: () => ({
      loadCatalog: () => Promise.resolve(true),
    }),
  },
}))

mock.module("@/stores/useSkillsStore", () => ({
  useSkillsStore: {
    getState: () => ({
      loadSkills: () => Promise.resolve(true),
    }),
  },
}))

describe("refreshAfterOpenCodeRestart", () => {
  beforeEach(() => {
    configMessages.length = 0
    dispatchedEvents.length = 0
    loadProviderDirectories.length = 0
    loadAgentOptions.length = 0
  })

  test("signals the realtime pipeline to reconnect during config refresh", async () => {
    globalThis.window = {
      dispatchEvent: (event: Event) => {
        dispatchedEvents.push(event.type)
        return true
      },
    } as unknown as Window & typeof globalThis

    try {
      const { refreshAfterOpenCodeRestart } = await import("./useAgentsStore")

      await refreshAfterOpenCodeRestart({
        scopes: ["providers"],
        mode: "active",
        delayMs: 0,
      })

      expect(dispatchedEvents).toContain("openchamber:system-resume")
      expect(loadProviderDirectories).toEqual(["/test/project"])
    } finally {
      globalThis.window = savedWindow
    }
  })

  test("forces SDK agent reloads so mode switches do not reuse stale agent lists", async () => {
    const { refreshAfterOpenCodeRestart } = await import("./useAgentsStore")

    await refreshAfterOpenCodeRestart({
      scopes: ["agents"],
      mode: "active",
      delayMs: 0,
    })

    expect(loadAgentOptions).toEqual([{ directory: "/test/project", force: true }])
  })
})
