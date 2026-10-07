import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSafeRunQualityProjectionFromDaemon,
  projectDeliverableSyntaxTelemetry,
  reportRunCompletedFromDaemon,
} from '../src/langfuse-bridge.js';

interface FakeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  resultDeliveryState?: string;
  attachments?: Array<Record<string, unknown>>;
  producedFiles?: Array<Record<string, unknown>>;
  traceObjectFiles?: Array<Record<string, unknown>>;
}

function makeDb(messagesByConvo: Record<string, FakeMessage[]> = {}) {
  return {
    __messages: messagesByConvo,
    prepare() {
      throw new Error('listMessages should be the only DB call in tests');
    },
  };
}

function makeDbWithListMessages(messagesByConvo: Record<string, FakeMessage[]>) {
  return {
    prepare(_sql: string) {
      return {
        all(cid: string) {
          return (messagesByConvo[cid] ?? []).map((m) => ({
            id: m.id, role: m.role, content: m.content,
            resultDeliveryState: m.resultDeliveryState ?? null,
            agentId: null, agentName: null, runId: null, runStatus: null,
            lastRunEventId: null, eventsJson: null,
            attachmentsJson: m.attachments ? JSON.stringify(m.attachments) : null,
            commentAttachmentsJson: null,
            producedFilesJson: m.producedFiles ? JSON.stringify(m.producedFiles) : null,
            traceObjectFilesJson: m.traceObjectFiles ? JSON.stringify(m.traceObjectFiles) : null,
            createdAt: 0, startedAt: null, endedAt: null, position: 0,
          }));
        },
      };
    },
  };
}

function makeRun(over: Partial<Parameters<typeof reportRunCompletedFromDaemon>[0]['run']> = {}) {
  const now = Date.now();
  return {
    id: 'run-id-1',
    projectId: 'proj-1',
    conversationId: 'conv-1',
    assistantMessageId: 'msg-1',
    agentId: 'claude',
    status: 'succeeded',
    createdAt: now - 4500,
    updatedAt: now,
    events: [
      {
        id: 1,
        event: 'agent',
        timestamp: now - 4000,
        data: {
          type: 'tool_use',
          id: 'tool-1',
          name: 'Bash',
          input: { command: 'ls -la' },
        },
      },
      {
        id: 2,
        event: 'agent',
        timestamp: now - 3500,
        data: {
          type: 'tool_result',
          toolUseId: 'tool-1',
          content: 'total 0',
          isError: false,
        },
      },
      {
        id: 3,
        event: 'agent',
        timestamp: now - 3000,
        data: {
          type: 'tool_use',
          id: 'tool-2',
          name: 'Write',
          input: { path: 'index.html' },
        },
      },
      {
        id: 4,
        event: 'agent',
        timestamp: now - 2500,
        data: {
          type: 'tool_result',
          toolUseId: 'tool-2',
          content: 'wrote index.html',
          isError: false,
        },
      },
      {
        id: 5,
        event: 'agent',
        timestamp: now - 2000,
        data: {
          type: 'usage',
          usage: { input_tokens: 100, output_tokens: 200 },
        },
      },
    ] as Array<{ id: number; event: string; data: unknown; timestamp?: number }>,
    userPrompt: 'design a coffee landing page',
    ...over,
  };
}

describe('langfuse-bridge deliverable syntax telemetry', () => {
  it('derives repaired value and accumulated checker timing from durable Run state', () => {
    expect(projectDeliverableSyntaxTelemetry(makeRun({
      deliverableSyntaxRepair: {
        schema: 'open-design.deliverable-syntax-repair/v1',
        attempt: 2,
        maxAttempts: 3,
        checker: 'web-syntax@1',
        candidateHash: 'content-free-not-exported',
        mode: 'host_safe_fixer',
      },
      deliverableSyntaxValidation: {
        schema: 'open-design.deliverable-syntax-tool/v1',
        status: 'pass',
        checker: 'web-syntax@1',
        candidateHash: 'content-free-not-exported',
        checkedFiles: ['index.html'],
        diagnostics: [],
        source: 'run_finalizer',
        checkedAt: 123,
        finalization: {
          action: 'allow', summaryVersion: 1, initialStatus: 'repairable',
          repairEngine: 'host-safe-fixer@2', stagedPatchCount: 2, committedPatchCount: 2,
          committedRepairRules: ['insert_missing_closing_delimiter'],
        },
        metrics: {
          schema: 'open-design.deliverable-syntax-metrics/v1',
          checkCount: 3,
          checkerDurationMs: 16,
          repairableCheckCount: 2,
          initialDiagnosticCount: 1,
          latestDiagnosticCount: 0,
          firstRepairableAtMs: 1_000,
          repairPassedAtMs: 1_650,
          repairWindowDurationMs: 650,
          repairToDeliveryDurationMs: 900,
          repairToTerminalDurationMs: 900,
          repairExecutor: 'host_safe_fixer',
          repairDurationMs: 8,
          appliedRepairRules: ['insert_missing_closing_delimiter'],
          safeFixProposalCount: 2,
          safeFixProposalDurationMs: 6,
        },
      },
    }))).toEqual({
      schemaVersion: 'deliverable-syntax-telemetry-v1',
      applicable: true,
      status: 'pass',
      source: 'run_finalizer',
      checker: 'web-syntax@1',
      checkedFileCount: 1,
      checkCount: 3,
      checkerDurationMs: 16,
      repairWindowDurationMs: 650,
      repairToDeliveryDurationMs: 900,
      repairToTerminalDurationMs: 900,
      terminalRunStatus: 'succeeded',
      finalization: {
        action: 'allow', summaryVersion: 1, initialStatus: 'repairable',
        repairEngine: 'host-safe-fixer@2', stagedPatchCount: 2, committedPatchCount: 2,
        committedRepairRules: ['insert_missing_closing_delimiter'],
      },
      repairExecutor: 'host_safe_fixer',
      repairDurationMs: 8,
      appliedRepairRules: ['insert_missing_closing_delimiter'],
      safeFixProposalCount: 2,
      safeFixProposalDurationMs: 6,
      repairableCheckCount: 2,
      initialDiagnosticCount: 1,
      latestDiagnosticCount: 0,
      repairTriggered: true,
      repairAttempts: 2,
      maxRepairAttempts: 8,
      repairOutcome: 'repaired',
      recoveredDeliveryCount: 1,
      blockedBrokenDeliveryCount: 0,
      deliveredWithSyntaxWarningCount: 0,
    });
  });

  it('recognizes a finalizer repairable result at the attempt cap as exhausted', () => {
    expect(projectDeliverableSyntaxTelemetry(makeRun({
      status: 'failed',
      deliverableSyntaxRepair: {
        schema: 'open-design.deliverable-syntax-repair/v1',
        attempt: 3,
        maxAttempts: 3,
        checker: 'web-syntax@1',
        candidateHash: 'not-exported',
      },
      deliverableSyntaxValidation: {
        schema: 'open-design.deliverable-syntax-tool/v1',
        status: 'repairable',
        checker: 'web-syntax@1',
        candidateHash: 'not-exported',
        checkedFiles: ['index.html'],
        diagnostics: [{
          code: 'JS_PARSE_ERROR',
          file: 'index.html',
          line: 1,
          column: 1,
          message: 'not exported',
          source: 'inline_script',
        }],
        source: 'run_finalizer',
        checkedAt: 123,
        finalization: { action: 'fail', reason: 'attempt_limit_reached' },
      },
    }))).toMatchObject({
      repairOutcome: 'exhausted',
      recoveredDeliveryCount: 0,
      blockedBrokenDeliveryCount: 1,
    });
  });

  const terminalEvidence = () => ({
    schema: 'open-design.deliverable-syntax-tool/v1' as const,
    status: 'pass' as const, checker: 'web-syntax@1' as const,
    candidateHash: 'private-hash', checkedFiles: ['/private/index.html'], diagnostics: [],
    source: 'run_finalizer' as const, checkedAt: 123,
    finalization: {
      action: 'allow' as const, summaryVersion: 1 as const, initialStatus: 'repairable' as const,
      repairEngine: 'host-safe-fixer@2' as const, stagedPatchCount: 1, committedPatchCount: 1,
      committedRepairRules: ['normalize_mismatched_string_quote' as const],
    },
    metrics: {
      schema: 'open-design.deliverable-syntax-metrics/v1' as const,
      checkCount: 2, checkerDurationMs: 10, repairableCheckCount: 1,
      initialDiagnosticCount: 1, latestDiagnosticCount: 0, repairExecutor: 'host_safe_fixer' as const,
    },
  });

  const warningEvidence = () => {
    const evidence = terminalEvidence();
    return {
      ...evidence,
      status: 'repairable' as const,
      finalization: {
        ...evidence.finalization,
        action: 'warn' as const,
        reason: 'no_safe_fix' as const,
        refusal: 'unsupported_syntax_error' as const,
        committedPatchCount: 0,
        committedRepairRules: [],
      },
    };
  };

  it.each(['repairable', 'pass'] as const)(
    'counts a completed warning without claiming recovery or blocking for %s', (status) => {
      const result = projectDeliverableSyntaxTelemetry({
        status: 'succeeded', deliverableSyntaxValidation: { ...warningEvidence(), status },
      });
      expect(result).toMatchObject({
        status, terminalRunStatus: 'succeeded', repairOutcome: 'unresolved',
        deliveredWithSyntaxWarningCount: 1, recoveredDeliveryCount: 0, blockedBrokenDeliveryCount: 0,
        finalization: { action: 'warn', reason: 'no_safe_fix', refusal: 'unsupported_syntax_error' },
      });
      expect(JSON.stringify(result)).not.toMatch(/private|candidateHash|checkedFiles/);
    },
  );

  it('keeps a warning for an incomplete checker distinct from a syntax error or repair', () => {
    const { refusal: _unusedRefusal, ...finalization } = warningEvidence().finalization;
    const result = projectDeliverableSyntaxTelemetry({
      status: 'succeeded', deliverableSyntaxValidation: {
        schema: 'open-design.deliverable-syntax-tool/v1', status: 'incomplete',
        reason: 'checker_error', source: 'run_finalizer', checkedAt: 123,
        finalization: {
          ...finalization, initialStatus: 'incomplete',
          stagedPatchCount: 0, reason: 'check_incomplete',
        },
      },
    });
    expect(result).toMatchObject({
      status: 'incomplete', checkCount: 0, checker: null, repairTriggered: false,
      repairOutcome: 'unresolved', deliveredWithSyntaxWarningCount: 1,
      recoveredDeliveryCount: 0, blockedBrokenDeliveryCount: 0,
      finalization: { action: 'warn', initialStatus: 'incomplete', reason: 'check_incomplete' },
    });
  });

  it.each(['failed', 'canceled'] as const)('does not count a warning as delivered on %s', (status) => {
    expect(projectDeliverableSyntaxTelemetry({
      status, deliverableSyntaxValidation: warningEvidence(),
    })).toMatchObject({
      deliveredWithSyntaxWarningCount: 0, recoveredDeliveryCount: 0, blockedBrokenDeliveryCount: 0,
    });
  });

  it('keeps warning delivery unknown without a physical terminal', () => {
    expect(projectDeliverableSyntaxTelemetry({ deliverableSyntaxValidation: warningEvidence() }))
      .not.toHaveProperty('deliveredWithSyntaxWarningCount');
  });

  it.each([
    { summaryVersion: undefined }, { summaryVersion: 2 }, { repairEngine: undefined },
    { initialStatus: undefined }, { stagedPatchCount: undefined }, { stagedPatchCount: 9 },
    { committedPatchCount: undefined }, { committedPatchCount: 2 },
    { committedRepairRules: undefined }, { committedRepairRules: ['private-unknown-rule'] },
  ])('keeps partial/invalid warning evidence unknown: %j', (partial) => {
    const evidence = warningEvidence();
    const result = projectDeliverableSyntaxTelemetry({
      status: 'succeeded', deliverableSyntaxValidation: {
        ...evidence,
        finalization: { ...evidence.finalization, ...partial } as unknown as typeof evidence.finalization,
      },
    });
    expect(result).not.toHaveProperty('deliveredWithSyntaxWarningCount');
    expect(result).toMatchObject({ recoveredDeliveryCount: 0, blockedBrokenDeliveryCount: 0 });
    expect(JSON.stringify(result)).not.toContain('private-unknown-rule');
  });

  it('does not reinterpret an unversioned warning as legacy Agent recovery', () => {
    const evidence = terminalEvidence();
    const result = projectDeliverableSyntaxTelemetry({
      status: 'succeeded', deliverableSyntaxValidation: {
        ...evidence, source: 'agent_tool', repair: { action: 'none', attempt: 1, maxAttempts: 3 },
        metrics: { ...evidence.metrics, repairExecutor: 'agent' },
        finalization: { action: 'warn', reason: 'no_safe_fix' },
      },
    });
    expect(result).toMatchObject({ repairOutcome: 'unresolved', recoveredDeliveryCount: 0, blockedBrokenDeliveryCount: 0 });
    expect(result).not.toHaveProperty('deliveredWithSyntaxWarningCount');
  });

  it('does not classify a warning as a clean check even when the staged parser verdict passed', () => {
    const evidence = warningEvidence();
    expect(projectDeliverableSyntaxTelemetry({
      status: 'succeeded', deliverableSyntaxValidation: {
        ...evidence, status: 'pass', finalization: {
          ...evidence.finalization, initialStatus: 'pass', stagedPatchCount: 0,
        },
      },
    })).toMatchObject({ repairOutcome: 'unresolved', deliveredWithSyntaxWarningCount: 1, recoveredDeliveryCount: 0 });
  });

  it('does not claim a legacy fail decision blocked a succeeded physical Run', () => {
    const evidence = warningEvidence();
    expect(projectDeliverableSyntaxTelemetry({
      status: 'succeeded', deliverableSyntaxValidation: {
        ...evidence, finalization: { action: 'fail', reason: 'no_safe_fix' },
      },
    })).toMatchObject({ recoveredDeliveryCount: 0, blockedBrokenDeliveryCount: 0 });
  });

  it.each(['commit_conflict', 'commit_failed', 'repair_budget_exceeded'] as const)(
    'does not report recovered delivery for a passing staged candidate with %s', (reason) => {
      const evidence = terminalEvidence();
      expect(projectDeliverableSyntaxTelemetry({
        status: 'failed', deliverableSyntaxValidation: {
          ...evidence, finalization: {
            ...evidence.finalization, action: 'fail', reason,
            committedPatchCount: 0, committedRepairRules: [],
          },
        },
      })).toMatchObject({
        status: 'pass', terminalRunStatus: 'failed', repairOutcome: 'unresolved',
        recoveredDeliveryCount: 0, blockedBrokenDeliveryCount: 1,
      });
    },
  );

  it('keeps old Host commit evidence unknown and never invents a verified recovery', () => {
    const { finalization: _unused, ...oldEvidence } = terminalEvidence();
    const result = projectDeliverableSyntaxTelemetry({ status: 'succeeded', deliverableSyntaxValidation: oldEvidence });
    expect(result).toMatchObject({ repairOutcome: 'unresolved', recoveredDeliveryCount: 0 });
    expect(result).not.toHaveProperty('finalization');
  });

  it.each([
    { repairEngine: undefined }, { stagedPatchCount: undefined },
    { committedPatchCount: undefined }, { committedRepairRules: undefined },
    { stagedPatchCount: -1 }, { stagedPatchCount: 1.5 }, { stagedPatchCount: 9 },
    { committedPatchCount: -1 }, { committedPatchCount: 2 },
    { committedRepairRules: [] },
    { committedRepairRules: ['private-unknown-rule'] },
  ])('keeps partial/contradictory version-1 evidence unresolved: %j', (partial) => {
    const evidence = terminalEvidence();
    const result = projectDeliverableSyntaxTelemetry({
      status: 'succeeded', deliverableSyntaxValidation: {
        ...evidence,
        finalization: { ...evidence.finalization, ...partial } as typeof evidence.finalization,
      },
    });
    expect(result).toMatchObject({ repairOutcome: 'unresolved', recoveredDeliveryCount: 0 });
    expect(JSON.stringify(result)).not.toContain('private-unknown-rule');
  });

  it('preserves the old timing as a terminal alias without inventing a recovery', () => {
    const { finalization: _unused, ...evidence } = terminalEvidence();
    expect(projectDeliverableSyntaxTelemetry({ status: 'failed', deliverableSyntaxValidation: {
      ...evidence, metrics: { ...evidence.metrics, repairToDeliveryDurationMs: 73 },
    } })).toMatchObject({
      repairToTerminalDurationMs: 73, repairToDeliveryDurationMs: 73, recoveredDeliveryCount: 0,
    });
  });

  it('does not downgrade an unknown summary version into legacy Agent recovery', () => {
    const evidence = terminalEvidence();
    expect(projectDeliverableSyntaxTelemetry({
      status: 'succeeded', deliverableSyntaxValidation: {
        ...evidence, source: 'agent_tool', repair: { action: 'none', attempt: 1, maxAttempts: 3 },
        metrics: { ...evidence.metrics, repairExecutor: 'agent' },
        finalization: { ...evidence.finalization, summaryVersion: 2 as 1 },
      },
    })).toMatchObject({ repairOutcome: 'unresolved', recoveredDeliveryCount: 0 });
  });

  it('does not downgrade a mixed Agent/Host summary missing its version into legacy recovery', () => {
    const evidence = terminalEvidence();
    const { summaryVersion: _missing, ...partialSummary } = evidence.finalization;
    expect(projectDeliverableSyntaxTelemetry({
      status: 'succeeded', deliverableSyntaxValidation: {
        ...evidence, source: 'agent_tool', repair: { action: 'none', attempt: 1, maxAttempts: 3 },
        metrics: { ...evidence.metrics, repairExecutor: 'agent' },
        finalization: partialSummary,
      },
    })).toMatchObject({ repairOutcome: 'unresolved', recoveredDeliveryCount: 0 });
  });

  it.each([
    { summaryVersion: undefined },
    { initialStatus: 'pass' as const },
    { repairEngine: 'host-safe-fixer@2' as const },
    { stagedPatchCount: 0 },
    { committedPatchCount: 0 },
    { committedRepairRules: [] },
  ].flatMap((partialSummary) => [0, 1].map((priorRepairs) => ({ partialSummary, priorRepairs }))))(
    'keeps any new summary field without a version unknown, even with Agent history: %j',
    ({ partialSummary, priorRepairs }) => {
      const evidence = terminalEvidence();
      expect(projectDeliverableSyntaxTelemetry({
        status: 'succeeded', deliverableSyntaxValidation: {
          ...evidence, source: 'agent_tool',
          repair: { action: 'none', attempt: priorRepairs, maxAttempts: 3 },
          metrics: {
            ...evidence.metrics, repairExecutor: 'agent', repairableCheckCount: priorRepairs,
            initialDiagnosticCount: priorRepairs,
          },
          // Persisted malformed JSON/objects need runtime coverage beyond the DTO's types.
          finalization: { action: 'allow', ...partialSummary } as unknown as typeof evidence.finalization,
        },
      })).toMatchObject({
        terminalRunStatus: 'succeeded', repairOutcome: 'unresolved',
        recoveredDeliveryCount: 0, blockedBrokenDeliveryCount: 0,
      });
    },
  );

  it('still accepts legacy Agent recovery when no new summary fields are present', () => {
    const evidence = terminalEvidence();
    expect(projectDeliverableSyntaxTelemetry({
      status: 'succeeded', deliverableSyntaxValidation: {
        ...evidence, source: 'agent_tool', repair: { action: 'none', attempt: 1, maxAttempts: 3 },
        metrics: { ...evidence.metrics, repairExecutor: 'agent' },
        finalization: { action: 'allow' },
      },
    })).toMatchObject({ repairOutcome: 'repaired', recoveredDeliveryCount: 1 });
  });

  it.each([null, 'malformed-finalization', 7, []])(
    'does not throw for a non-object legacy summary container: %j', (finalization) => {
      const evidence = terminalEvidence();
      expect(projectDeliverableSyntaxTelemetry({
        status: 'succeeded', deliverableSyntaxValidation: {
          ...evidence, source: 'agent_tool', repair: { action: 'none', attempt: 1, maxAttempts: 3 },
          metrics: { ...evidence.metrics, repairExecutor: 'agent' },
          finalization: finalization as unknown as typeof evidence.finalization,
        },
      })).toMatchObject({ repairOutcome: 'repaired', recoveredDeliveryCount: 1 });
    },
  );

  it('does not attribute prior Agent repairs to a Host check that initially passed', () => {
    const evidence = terminalEvidence();
    expect(projectDeliverableSyntaxTelemetry({
      status: 'succeeded', deliverableSyntaxValidation: {
        ...evidence, finalization: {
          ...evidence.finalization, initialStatus: 'pass', stagedPatchCount: 0,
          committedPatchCount: 0, committedRepairRules: [],
        },
      },
    })).toMatchObject({ repairOutcome: 'not_needed', recoveredDeliveryCount: 0 });
  });

  it('requires a successful physical terminal and strips non-whitelisted summary data', () => {
    const evidence = terminalEvidence();
    const result = projectDeliverableSyntaxTelemetry({
      status: 'canceled', deliverableSyntaxValidation: {
        ...evidence, finalization: {
          ...evidence.finalization, committedRepairRules: [...evidence.finalization.committedRepairRules],
          ...{ source: '<script>private</script>', path: '/private/index.html' },
        },
      },
    });
    expect(result).toMatchObject({ repairOutcome: 'unresolved', recoveredDeliveryCount: 0 });
    expect(JSON.stringify(result)).not.toMatch(/private|script|candidateHash/);
  });

  it('counts an explicit syntax refusal as blocked, but not an incomplete check', () => {
    const evidence = terminalEvidence();
    expect(projectDeliverableSyntaxTelemetry({
      status: 'failed', deliverableSyntaxValidation: {
        ...evidence, status: 'repairable', finalization: {
          ...evidence.finalization, action: 'fail', reason: 'no_safe_fix',
          refusal: 'unsupported_syntax_error', committedPatchCount: 0, committedRepairRules: [],
        },
      },
    })).toMatchObject({ blockedBrokenDeliveryCount: 1, recoveredDeliveryCount: 0 });
    expect(projectDeliverableSyntaxTelemetry({
      status: 'failed', deliverableSyntaxValidation: {
        schema: 'open-design.deliverable-syntax-tool/v1', status: 'incomplete',
        reason: 'process_tree_not_quiescent', source: 'run_finalizer', checkedAt: 123,
        finalization: { action: 'fail', reason: 'check_incomplete' },
      },
    })).toMatchObject({ blockedBrokenDeliveryCount: 0, recoveredDeliveryCount: 0 });
  });
});

describe('detached run reporting', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-bridge-'));
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('retains the safe local quality projection without exporting it', async () => {
    const run = makeRun({ status: 'failed', error: 'token=sk-test-1234567890123456789012 /Users/alice/private', errorCode: 'AGENT_EXIT' });
    const db = makeDbWithListMessages({ 'conv-1': [
      { id: 'u1', role: 'user', content: 'request' },
      { id: 'msg-1', role: 'assistant', content: 'done' },
    ] });
    const quality = await buildSafeRunQualityProjectionFromDaemon({
      db, dataDir, run, prefs: { metrics: true, content: true, artifactManifest: false },
      installationId: 'installation-fixture',
    });
    expect(quality?.result?.error).toMatchObject({ code: 'AGENT_EXIT' });
    expect(JSON.stringify(quality)).not.toContain('sk-test-');
    const fetchImpl = vi.fn<typeof fetch>();
    await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify({
      installationId: 'installation-fixture', telemetry: { metrics: true, content: true },
    }));
    const result = await reportRunCompletedFromDaemon({ db, dataDir, run, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.langfuse_expected).toBe(false);
  });
});
