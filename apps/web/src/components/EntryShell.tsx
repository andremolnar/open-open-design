// EntryShell — the centered-hero entry layout.
//
// This component owns the entire JSX render and local UI state for
// the redesigned home view (left rail + sticky settings cog + hero +
// recent projects + plugins section + new-project modal). It is
// intentionally a sibling of `EntryView` so that upstream `main`
// changes to `EntryView` (props, connector lifecycle, helpers, exports)
// can be rebased without touching this file. `EntryView` becomes a
// thin wrapper that passes data and callbacks through to this shell.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  automaticStrategyTaskProfileForProjectMetadata,
  defaultScenarioPluginIdForProjectMetadata,
  type ChatSessionMode,
  type ConnectorDetail,
  type CreateProjectExampleReference,
  type InstalledPluginRecord,
  type RunContextSelection,
  type ProjectScenarioTaskProfile,
  type WorkspaceProjectSummary,
} from '@open-design/contracts';
import type { OpenDesignHostProjectImportSuccess } from '@open-design/host';
import { useAnalytics } from '../analytics/provider';
import { trackHomeNavClick, trackPageView } from '../analytics/events';
import { useI18n } from '../i18n';
import { navigate, useRoute } from '../router';
import type {
  AgentInfo,
  ApiProtocol,
  AppConfig,
  DesignSystemSummary,
  ExecMode,
  Project,
  ProjectKind,
  ProjectMetadata,
  ProjectTemplate,
  PromptTemplateSummary,
  SkillSummary,
} from '../types';
import { CenteredLoader } from './Loading';
import { DesignsTab } from './DesignsTab';
import { DesignSystemsTab } from './DesignSystemsTab';
import { BrandsTab } from './BrandsTab';
import { EntryNavRail, type EntryView as EntryViewKind } from './EntryNavRail';
import {
  buildProjectSearchCatalog,
  ProjectSearchModal,
} from './ProjectSearchModal';
import {
  RailAccountRecoveryTip,
  RailAccountSyncTip,
} from './CloudSignInTip';
import {
  resolveEntryRailAccountFooterState,
  requiresAmrReauthentication,
} from './entry-rail-account-state';
import { LibrarySection } from './LibrarySection';
import { WhatsNewPopup } from './WhatsNewPopup';
import { DeepSeekHarnessSetupDialog } from './DeepSeekHarnessSetupDialog';
import type { HomeAmrBalanceGateBlock } from './HomeAmrBalanceGateDialogs';
import {
  amrBalanceBlockedDialog,
  amrBalanceDialogUpgradeIntent,
  resolveAmrBalanceBranch,
} from '../runtime/amr-balance-branch';
import { installDeepSeekHarnessCompanion } from '../providers/agent-companion';
import {
  amrBalanceGateScopeForWorkspaceContext,
  checkAmrBalanceGate,
  retryUnavailableAmrBalanceGate,
  type AmrBalanceGateScope,
} from '../runtime/amr-balance-gate';
import { HomeView, seedHomeComposerPrompt } from './HomeView';
import { entryStrategyRoutingFields } from './entry-strategy-routing';
import { EntryBlankState } from './EntryBlankState';
import { RecentProjectsStrip, type ProjectCollectionScope } from './RecentProjectsStrip';
import {
  createPluginAuthoringHandoff,
  createPluginUseHandoff,
  createSkillUseHandoff,
  takeHomePromptHandoff,
  type HomePromptHandoff,
} from './home-hero/plugin-authoring';
import type { OnboardingEntry } from '../onboarding/onboarding-entry';
import type { PluginUseAction } from './plugins-home/useActions';
import { Icon } from './Icon';
import { Button } from '@open-design/components';
import {
  defaultAgentModelId,
  effectiveAgentModelChoice,
  effectiveAgentModelId,
} from './agentModelSelection';
import { CommunityView } from './CommunityView';
import { TeamSlotPlaceholder } from './TeamSlotPlaceholder';
import {
  notifyTeamProjectsChanged,
  notifyWorkspaceBillingRefresh,
  notifyWorkspaceContextRefresh,
  currentWorkspaceAccountGeneration,
  useTeamProjects,
  useWorkspaceBillingResponse,
  useWorkspaceContext,
  workspaceResourceReadContext,
  workspaceBillingBalanceUsd,
  workspaceBillingSummaryForContext,
} from '../collab/useWorkspaceContext';
import { useWorkspaceInvalidation } from '../collab/workspace-events';
import { resolvePlanLabelTier } from '../collab/team-plan';
import { resolveDeepSeekV4FlashCampaignAudience } from '../campaigns/deepseek-v4-flash';
import { useDeepSeekV4FlashCampaignVisibility } from '../campaigns/use-deepseek-v4-flash-campaign';
import { WorkbenchCampaignBadge } from './WorkbenchCampaignBadge';
import {
  beginWorkspaceScopedRead,
  workspaceIdentityCacheKey,
  workspaceProjectHeaders,
} from '../collab/workspace-identity';
import {
  buildAllProjectsList,
  buildDraftsList,
  createSharedProjectPredicate,
  reconcileSharedProjectCatalogFields,
} from '../collab/all-projects-list';
import {
  forgetOptimisticProjectOwnership,
  optimisticProjectOwnershipScopeKey,
  projectOwnerMemberIdsWithOptimisticWitnesses,
  reconcileOptimisticProjectOwnership,
  recordOptimisticProjectOwnership,
  type OptimisticProjectOwnershipWitnesses,
} from '../collab/optimistic-project-ownership';
import type { ModelCapabilityTag } from './modelCapabilityTags';
import { IntegrationsView, type IntegrationTab } from './IntegrationsView';
import { InlineModelSwitcher } from './InlineModelSwitcher';
import { type EntrySettingsSection } from './EntrySettingsMenu';
import { NewProjectModal } from './NewProjectModal';
import { ExtensionsMarketplace } from './PluginsView';
import type { CreateInput, CreateTab, ImportClaudeDesignOutcome } from './NewProjectPanel';
import type { PluginLoopSubmit } from './PluginLoopHome';
import {
  duplicatePluginAsProject,
  patchProject,
  ProjectCreateError,
  resolvedWorkspaceContextForWrite,
  type PluginShareAction,
  type PluginShareProjectOutcome,
} from '../state/projects';
import { TasksView } from './TasksView';
import { invalidateProjectFilesCache } from '../providers/registry';
import type { VelaLoginStatus } from '../providers/daemon';
import { isAmrSessionAuthenticated } from './amrLoginPolling';
import { isMacPlatform } from '../utils/platform';
import { smoothScrollToTop } from '../utils/smoothScrollToTop';
import { summarizeProjectNameFromPrompt } from '../utils/projectName';
import { LIBRARY_UI_VISIBLE } from '../features/libraryUi';
import {
  providerModelsCacheKey,
  type ProviderModelsCache,
} from './providerModelsCache';
import {
  ENTRY_RAIL_STATE_EVENT,
  ENTRY_RAIL_TOGGLE_EVENT,
  ENTRY_SEARCH_OPEN_EVENT,
  RAIL_OPEN_STORAGE_KEY,
  readStoredRailOpen,
} from './entryRailBridge';

// Persist the entry nav-rail open/collapsed state so it survives both a
// home -> project -> home navigation (EntryShell unmounts on the project
// route) and a full reload. Without this the rail always reset to its
// collapsed default on return. The storage key, the rail toggle/state window
// events, and the seed reader live in `entryRailBridge` so the pinned Home
// tab's sidebar toggle (WorkspaceTabsBar, a sibling React tree) can share
// them without importing this module's graph.
export { ENTRY_RAIL_STATE_EVENT, ENTRY_RAIL_TOGGLE_EVENT };

function writeStoredRailOpen(open: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RAIL_OPEN_STORAGE_KEY, open ? 'true' : 'false');
  } catch {
    /* ignore quota / disabled storage */
  }
}

// The topbar chips (GitHub star, model switcher, Use everywhere)
// collapse into the settings dropdown when the viewport gets
// narrow. The transition is driven entirely by CSS @media queries
// in `entry-layout.css` so server and client render identical
// markup — both surfaces are always present, and CSS toggles
// `display` based on `--compact-topbar` breakpoint (900px).

// Default scenario plugin for each project kind/intent. The mapping
// lives in `@open-design/contracts` so the daemon's `/api/projects`
// and `/api/runs` fallbacks resolve to the same plugin id when no
// `pluginId` is on the request body — plan §3.3 of
// `specs/current/plugin-driven-flow-plan.md`.
type EntryCreateProjectInput = Omit<CreateInput, 'metadata'> & {
  metadata?: CreateInput['metadata'];
  pendingPrompt?: string;
  pluginId?: string;
  pluginSource?: string;
  skillCatalogScope?: PluginLoopSubmit['skillCatalogScope'];
  designSystemCatalogScope?: PluginLoopSubmit['designSystemCatalogScope'];
  pluginType?: string;
  appliedPluginSnapshotId?: string;
  pluginInputs?: Record<string, unknown>;
  automaticStrategyTaskProfile?: ProjectScenarioTaskProfile;
  /** Official example card the user picked under the automatic route. */
  exampleReference?: CreateProjectExampleReference;
  initialRunContext?: RunContextSelection | null;
  conversationMode?: ChatSessionMode;
  autoSendFirstMessage?: boolean;
  /** Exact workspace/member authority checked by the Home AMR preflight. */
  amrGatePrecheckWitness?: AmrBalanceGateScope;
  /**
   * The optimistic project already flushed by `onBeginProjectCreation`. The
   * create reuses this id (the daemon accepts a caller-minted id) instead of
   * starting a second hand-off.
   */
  optimisticProjectId?: string;
  requestId?: string;
  pendingFiles?: File[];
  userWorkingDirToken?: string;
  linkedDirs?: string[] | null;
  onboardingEntry?: OnboardingEntry;
};

/**
 * What App hands back once a Home send has entered the project frame
 * optimistically: the client-minted project id the create must reuse, and the
 * way to undo the hand-off (drop the optimistic row, return to Home with the
 * draft and staged files intact) when no project is going to be created —
 * a dismissed balance dialog, or a gate that could not answer.
 */
export interface OptimisticProjectCreationHandoff {
  projectId: string;
  rollback: (options?: { notice?: string }) => void;
}

function defaultPluginIdForMetadata(metadata: ProjectMetadata): string | null {
  return defaultScenarioPluginIdForProjectMetadata(metadata);
}

function defaultPluginInputsForCreate(
  input: CreateInput,
  pluginId: string | null,
): Record<string, unknown> | null {
  const kind = input.metadata.kind;
  const projectName = input.name.trim();

  if (pluginId === 'example-web-prototype') {
    return {
      artifactKind: input.metadata.includeLandingPage
        ? 'landing page'
        : 'web prototype',
      fidelity: input.metadata.fidelity ?? 'high-fidelity',
      audience: 'product evaluators',
      designSystem: 'the active project design system',
      template: input.metadata.templateLabel ?? 'the bundled web prototype seed',
    };
  }

  if (pluginId === 'example-simple-deck') {
    return {
      deckType: 'pitch deck',
      topic: projectName || 'the user brief',
      audience: 'decision makers',
      slideCount: '10-15 pages',
      speakerNotes: input.metadata.speakerNotes
        ? 'include speaker notes'
        : 'no speaker notes',
      designSystem: 'the active project design system',
    };
  }

  if (pluginId === 'od-new-generation') {
    const templateLabel = input.metadata.templateLabel?.trim();
    const artifactKind =
      kind === 'template'
        ? 'artifact based on a saved template'
        : kind === 'other'
          ? 'custom design artifact'
          : `${kind} artifact`;
    return {
      artifactKind,
      audience: 'product and design reviewers',
      topic: templateLabel || projectName || 'the user brief',
    };
  }

  if (pluginId !== 'od-media-generation') return null;
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null;

  const promptTemplate = input.metadata.promptTemplate;
  const subject =
    promptTemplate?.prompt?.trim()
    || projectName
    || promptTemplate?.title?.trim()
    || `${kind} concept`;
  const style =
    promptTemplate?.summary?.trim()
    || 'cinematic, high-quality, on-brand';
  const aspect =
    kind === 'image'
      ? input.metadata.imageAspect
      : kind === 'video'
        ? input.metadata.videoAspect
        : undefined;

  return {
    mediaKind: kind,
    subject,
    style,
    ...(aspect ? { aspect } : {}),
  };
}

export interface ProjectTitleHint {
  name: string;
  /** Workspace whose catalog produced this hint; null for a local-only row. */
  workspaceId: string | null;
  /** Member authorization lifetime that produced the catalog row. */
  workspaceMemberId: string | null;
  /**
   * The team catalog is the title authority for a project shared by another
   * member. Own/private projects may still accept a newer local rename.
   */
  authoritative: boolean;
}

interface Props {
  skills: SkillSummary[];
  designTemplates: SkillSummary[];
  designSystems: DesignSystemSummary[];
  projects: Project[];
  templates: ProjectTemplate[];
  onDeleteTemplate?: (id: string) => Promise<boolean>;
  promptTemplates: PromptTemplateSummary[];
  defaultDesignSystemId: string | null;
  connectors: ConnectorDetail[];
  connectorsLoading: boolean;
  integrationInitialTab?: IntegrationTab;
  composioConfigLoading?: boolean;
  skillsLoading?: boolean;
  designSystemsLoading?: boolean;
  projectsLoading?: boolean;
  // Execution / model-switching context. Threaded down from `App` so the
  // top-bar `InlineModelSwitcher` can render the active mode/agent/model
  // and persist changes through the same callbacks the project view uses.
  config: AppConfig;
  providerModelsCache?: ProviderModelsCache;
  onProviderModelsCacheChange?: Dispatch<SetStateAction<ProviderModelsCache>>;
  agents: AgentInfo[];
  // True while the cold-start agent detection stream is still in flight
  // (`fetchAgentsStream` has not reached its terminal `done`). Onboarding
  // uses this to show the AMR cloud card in a detecting/skeleton state
  // instead of hiding it during the seconds AMR's probe takes to settle.
  agentsLoading?: boolean;
  // Local credential state is independent from the remote workspace read.
  // During a transient Cloud outage it prevents the rail from presenting a
  // still-signed-in user as signed out.
  amrLoggedIn?: boolean | null;
  amrSessionState?: import('@open-design/contracts').AmrSessionState;
  /**
   * vela login-status account/user plan (ACCOUNT-scoped). Used for personal
   * workspaces so a confirmed free account is not stuck as campaign audience
   * `unknown` while billing summary leaves `membershipTier` empty.
   */
  amrAccountPlan?: string | null;
  amrAccountId?: string | null;
  daemonLive: boolean;
  onModeChange: (mode: ExecMode) => void;
  onAgentChange: (id: string) => void;
  onAgentModelChange: (
    id: string,
    choice: { model?: string; reasoning?: string; serviceTier?: string },
  ) => void;
  onApiProtocolChange: (protocol: ApiProtocol) => void;
  onApiModelChange: (model: string) => void;
  onConfigPersist: (cfg: AppConfig) => Promise<void> | void;
  /** True only when GET /api/app-config returned a real config object. */
  daemonAppConfigReady?: boolean;
  /** Non-optimistic daemon write for the silent-update preference. */
  onSilentUpdatePreferenceChange?: (allowSilentUpdates: boolean) => Promise<void>;
  onSkillsRefresh?: () => Promise<void> | void;
  onSkillsChanged?: (affectedSkillId?: string) => void;
  onRefreshAgents: () => Promise<AgentInfo[]> | AgentInfo[];
  onCreateProject: (input: EntryCreateProjectInput) => Promise<boolean> | boolean | void;
  /**
   * Flush the optimistic project frame for a Home send on the click tick,
   * before any admission check. Owned by App because the hand-off leaves the
   * Home route (and unmounts this shell).
   */
  onBeginProjectCreation: (input: EntryCreateProjectInput) => OptimisticProjectCreationHandoff;
  /**
   * Publish (or clear) the AMR balance-gate hard block for App to render. The
   * dialog cannot live here: by the time the gate answers, the send is already
   * on the project route and this shell is unmounted (see
   * `HomeAmrBalanceGateDialogs`).
   */
  onAmrBalanceGateBlockChange: (block: HomeAmrBalanceGateBlock | null) => void;
  onCreatePluginShareProject: (
    pluginId: string,
    action: PluginShareAction,
    locale?: string,
  ) => Promise<PluginShareProjectOutcome>;
  onImportClaudeDesign: (
    file: File,
  ) => Promise<ImportClaudeDesignOutcome | void> | ImportClaudeDesignOutcome | void;
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  onImportFolderResponse?: (response: OpenDesignHostProjectImportSuccess) => Promise<void> | void;
  onOpenProject: (
    id: string,
    fileName?: string,
    projectTitleHint?: ProjectTitleHint,
  ) => Promise<boolean> | boolean | void;
  onOpenLiveArtifact: (projectId: string, artifactId: string) => void;
  onDeleteProject: (id: string) => Promise<boolean | void> | boolean | void;
  onDuplicateProject?: (id: string) => Promise<void> | void;
  onRenameProject: (id: string, name: string) => void;
  onProjectsRefresh?: () => Promise<void> | void;
  onTeamProjectContentReady?: (
    projectId: string,
    workspaceId: string,
    workspaceMemberId: string,
  ) => Promise<boolean> | boolean;
  onChangeDefaultDesignSystem: (id: string) => void;
  onCreateDesignSystem?: () => void;
  onOpenDesignSystem?: (id: string) => void;
  onDesignSystemsRefresh?: () => Promise<void> | void;
  onPersistComposioKey: (composio: AppConfig['composio']) => Promise<void> | void;
  onOpenSettings: (section?: EntrySettingsSection) => void;
  /** Legacy prop retained for callers; entry no longer routes through onboarding. */
  onCompleteOnboarding?: () => void;
  onSignedOut?: () => void | Promise<void>;
  onAmrLoginStatusChange?: (status: VelaLoginStatus | null) => void;
  artifactUpgradeSlot?: ReactNode;
}

// Map an EntryNavRail view id to the existing analytics `element` enum on
// `home/nav` ui_click. Keep this compatibility signal alongside the new
// Workspace navigation dimensions so established PostHog dashboards do not
// lose their historical series.
function navElementForView(
  next: EntryViewKind,
):
  | 'home'
  | 'projects'
  | 'automations'
  | 'plugins'
  | 'design_systems'
  | 'integrations'
  | null {
  switch (next) {
    case 'home':
      return 'home';
    case 'projects':
      return 'projects';
    case 'tasks':
      return 'automations';
    case 'plugins':
      return 'plugins';
    case 'design-systems':
      return 'design_systems';
    case 'brands':
      return 'design_systems';
    case 'integrations':
      return 'integrations';
    default:
      return null;
  }
}

// Tab views stay mounted (so previews/thumbnails survive a tab switch) but the
// inactive ones must leave layout, the accessibility tree, and tab order.
// `content-visibility: hidden` still reserves the hidden pane's block size,
// which pushes later sidebar destinations far below the sticky topbar.
function inactiveViewProps(active: boolean) {
  return {
    style: active ? undefined : ({ display: 'none' } as const),
    inert: !active,
    'aria-hidden': !active,
  };
}

export function EntryShell({
  skills,
  designTemplates,
  designSystems,
  projects,
  templates,
  onDeleteTemplate,
  promptTemplates,
  defaultDesignSystemId,
  connectors,
  connectorsLoading,
  integrationInitialTab = 'mcp',
  composioConfigLoading = false,
  skillsLoading = false,
  designSystemsLoading = false,
  projectsLoading = false,
  config,
  providerModelsCache: sharedProviderModelsCache,
  onProviderModelsCacheChange,
  agents,
  agentsLoading = false,
  amrLoggedIn = null,
  amrSessionState,
  amrAccountPlan = null,
  amrAccountId = null,
  daemonLive,
  onModeChange,
  onAgentChange,
  onAgentModelChange,
  onApiProtocolChange,
  onApiModelChange,
  onConfigPersist,
  daemonAppConfigReady = false,
  onSilentUpdatePreferenceChange,
  onSkillsRefresh,
  onSkillsChanged,
  onRefreshAgents,
  onCreateProject,
  onBeginProjectCreation,
  onAmrBalanceGateBlockChange,
  onImportClaudeDesign,
  onImportFolder,
  onImportFolderResponse,
  onOpenProject,
  onOpenLiveArtifact,
  onDeleteProject,
  onDuplicateProject,
  onRenameProject,
  onProjectsRefresh,
  onTeamProjectContentReady,
  onChangeDefaultDesignSystem,
  onCreateDesignSystem,
  onOpenDesignSystem,
  onDesignSystemsRefresh,
  onPersistComposioKey,
  onOpenSettings,
  onSignedOut,
  onAmrLoginStatusChange,
  artifactUpgradeSlot,
}: Props) {
  const { t } = useI18n();
  // Each entry sub-view (home / projects / design-systems) is its own
  // URL now, so the browser back/forward buttons work and a deep link
  // to /design-systems lands on that section. We derive the active
  // view from the route rather than keeping it in component state.
  const route = useRoute();
  const view: EntryViewKind = route.kind === 'home' ? route.view : 'home';
  // The one shared workspace context. Any non-null context is a real workspace
  // (personal or team); workspace surfaces gate on B's permission bits, not on
  // workspaceType.
  // The whole state (not just `context`) so workspace-scoped WRITES can go
  // through `resolvedWorkspaceContextForWrite`, which refuses to collapse an
  // unresolved or unavailable authority into an anonymous, unbound create.
  const workspaceContextState = useWorkspaceContext();
  const { context: workspaceContext, loading: workspaceLoading } = workspaceContextState;
  const accountFooterState = resolveEntryRailAccountFooterState(
    workspaceContextState,
    amrLoggedIn,
    amrSessionState,
  );
  const railWorkspaceContext = accountFooterState === 'sign-in'
    ? null
    : workspaceContext;
  const usesOpenDesignCloud = config.mode === 'daemon' && config.agentId === 'amr';
  const amrProfile = config.agentCliEnv?.amr?.OPEN_DESIGN_AMR_PROFILE ?? null;
  const amrAuthRequired = usesOpenDesignCloud && (
    workspaceContextState.failure === 'reauth-required'
    || requiresAmrReauthentication(amrSessionState, workspaceContextState.failure)
  );
  let accountFooterNotice: ReactNode = null;
  if (accountFooterState === 'syncing') {
    accountFooterNotice = <RailAccountSyncTip />;
  } else if (accountFooterState === 'recovering') {
    accountFooterNotice = <RailAccountRecoveryTip />;
  }
  const workspaceContextRef = useRef(workspaceContext);
  workspaceContextRef.current = workspaceContext;
  const workspaceContextStateRef = useRef(workspaceContextState);
  workspaceContextStateRef.current = workspaceContextState;
  const workspaceBillingResponse = useWorkspaceBillingResponse();
  // Plan and money are both workspace-scoped questions, so both go through a
  // context-partitioned projection. `response.summary` on its own is an ACCOUNT
  // read (`workspaceId: null` by contract) — feeding it to the rail's plan
  // nameplate is what kept a personal Plus badge on a 免费 workspace while the
  // 额度 row beside it correctly followed the switch.
  const workspaceBilling = workspaceBillingSummaryForContext(
    workspaceBillingResponse,
    workspaceContext,
  );
  const [goPlanSunsetMessagePending, setGoPlanSunsetMessagePending] = useState(false);
  const deepSeekCampaignVisibility = useDeepSeekV4FlashCampaignVisibility();
  // Same personal-vs-team accountPlan rule as App's `resolvedAmrPlan`.
  const deepSeekCampaignPlan = resolvePlanLabelTier({
    billing: workspaceBilling,
    context: workspaceContext,
    accountPlan:
      workspaceLoading || workspaceContext?.workspaceType === 'team'
        ? null
        : amrAccountPlan?.trim() || null,
  });
  const resolvedDeepSeekV4FlashCampaignAudience = resolveDeepSeekV4FlashCampaignAudience({
    // Subscription is the only campaign segmentation axis. In particular,
    // `resolvePlanLabelTier` turns the backend-confirmed unsubscribed state into
    // `free`; wallet balance / historical recharge never upgrades this audience.
    plan: deepSeekCampaignPlan,
    loggedIn: amrLoggedIn,
    now: deepSeekCampaignVisibility.now,
  });
  const deepSeekV4FlashCampaignAudience = goPlanSunsetMessagePending
    ? 'unknown'
    : resolvedDeepSeekV4FlashCampaignAudience;
  const topRightCampaignAudience =
    deepSeekV4FlashCampaignAudience === 'unknown'
      ? null
      : deepSeekV4FlashCampaignAudience;
  // The CMS touchpoints this rail hosts are home placements (`opend.home.*`).
  // The rail itself rides every entry view, so the home view — not the rail —
  // is what decides whether they may be on screen.
  const homeCampaignHostsVisible = view === 'home';
  const workspaceBalanceUsd = workspaceBillingBalanceUsd(
    workspaceBillingResponse,
    workspaceContext,
  );
  // Team-wide shared-project discovery for the "全部项目" view. The member's own
  // `projects` prop is only their LOCAL list; team-shared projects come from the
  // resource hub through the daemon. Empty off-team / when the hub is unconfigured.
  const teamProjects = useTeamProjects();
  const hasWorkspaceContext = Boolean(workspaceContext);
  // The "全部项目" grid is the SAME project-card grid used everywhere; its
  // membership rule lives in `buildAllProjectsList`. Rows flow through
  // `RecentProjectsStrip` like any other card — no custom section.
  const localProjectIds = new Set(projects.map((project) => project.id));
  // The optimistic share layer lives HERE, above every project strip, because a
  // share has to move TWO things at once: the card's 共享 badge and which grid
  // the card sits in. It used to live inside `RecentProjectsStrip`, so the badge
  // flipped on click while 草稿 kept the card until the next team-projects poll
  // (acceptance: 「转入团队空间, 怎么还显示在草稿里…切到全部项目再切回草稿它才消失」).
  const [sharedThisSession, setSharedThisSession] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [unsharedThisSession, setUnsharedThisSession] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const optimisticOwnershipScopeKey = optimisticProjectOwnershipScopeKey(
    workspaceContext,
    currentWorkspaceAccountGeneration(),
  );
  const [optimisticOwnershipWitnesses, setOptimisticOwnershipWitnesses] = useState<
    OptimisticProjectOwnershipWitnesses
  >(() => new Map());
  const markProjectShared = useCallback((project: WorkspaceProjectSummary) => {
    setSharedThisSession((prev) => new Set(prev).add(project.id));
    setUnsharedThisSession((prev) => {
      const next = new Set(prev);
      next.delete(project.id);
      return next;
    });
    setOptimisticOwnershipWitnesses((prev) => recordOptimisticProjectOwnership(prev, {
      scopeKey: optimisticOwnershipScopeKey,
      context: workspaceContext,
      project,
    }));
  }, [optimisticOwnershipScopeKey, workspaceContext]);
  const markProjectShareFailed = useCallback((projectId: string) => {
    setSharedThisSession((prev) => {
      if (!prev.has(projectId)) return prev;
      const next = new Set(prev);
      next.delete(projectId);
      return next;
    });
    setOptimisticOwnershipWitnesses((prev) =>
      forgetOptimisticProjectOwnership(prev, projectId));
  }, []);
  const markProjectUnshared = useCallback((projectId: string) => {
    setUnsharedThisSession((prev) => new Set(prev).add(projectId));
    setSharedThisSession((prev) => {
      const next = new Set(prev);
      next.delete(projectId);
      return next;
    });
    setOptimisticOwnershipWitnesses((prev) =>
      forgetOptimisticProjectOwnership(prev, projectId));
  }, []);
  useEffect(() => {
    setOptimisticOwnershipWitnesses((prev) => reconcileOptimisticProjectOwnership(prev, {
      scopeKey: optimisticOwnershipScopeKey,
      teamProjects: teamProjects.projects,
    }));
    const catalogProjectIds = new Set(
      teamProjects.projects.map((project) => project.projectId),
    );
    setSharedThisSession((prev) => {
      if (![...prev].some((projectId) => catalogProjectIds.has(projectId))) return prev;
      return new Set([...prev].filter((projectId) => !catalogProjectIds.has(projectId)));
    });
  }, [optimisticOwnershipScopeKey, teamProjects.projects]);
  // The single shared-state answer, handed to the grids AND to every strip.
  const isSharedProject = useMemo(
    () =>
      createSharedProjectPredicate({
        teamProjects: teamProjects.projects,
        localProjects: projects,
        workspaceContext,
        sharedThisSession,
        unsharedThisSession,
      }),
    [projects, teamProjects.projects, workspaceContext, sharedThisSession, unsharedThisSession],
  );
  // 草稿 is the complement of 全部项目: sharing moves a project from one to the
  // other, so a shared project must stop appearing here (acceptance #78).
  const draftProjectsList: Project[] = buildDraftsList({
    projects,
    teamProjects: teamProjects.projects,
    workspaceContext,
    isShared: isSharedProject,
  });
  const allProjectsList: Project[] = buildAllProjectsList({
    projects,
    teamProjects: teamProjects.projects,
    workspaceContext,
    sharedFallbackName: t('recentProjects.sharedProjectFallbackName'),
    isShared: isSharedProject,
  });
  const projectSearchProjects = buildProjectSearchCatalog(draftProjectsList, allProjectsList);
  const homeProjectsList = useMemo(
    () => reconcileSharedProjectCatalogFields({
      projects,
      teamProjects: teamProjects.projects,
      workspaceContext,
    }),
    [projects, teamProjects.projects, workspaceContext],
  );
  // projectId → sharing member id, so a card in the 全部项目 / 草稿 grids can
  // resolve "{creator}创建" against the member directory. A project absent here
  // is the member's own local project → "我创建".
  const teamProjectOwnerMemberIds = useMemo(
    () => projectOwnerMemberIdsWithOptimisticWitnesses({
      scopeKey: optimisticOwnershipScopeKey,
      teamProjects: teamProjects.projects,
      witnesses: optimisticOwnershipWitnesses,
    }),
    [optimisticOwnershipScopeKey, optimisticOwnershipWitnesses, teamProjects.projects],
  );
  const contentReadyProjectIdsRef = useRef(new Set<string>());
  const pendingContentReadyProjectIdsRef = useRef(
    new Map<string, { workspaceId: string; workspaceMemberId: string }>(),
  );
  const contentReadyHydrationRef = useRef(new Map<string, Promise<boolean>>());
  const teamProjectIdsRef = useRef(new Set<string>());
  teamProjectIdsRef.current = new Set(
    teamProjects.projects.map((project) => project.projectId),
  );
  const readyWorkspaceId = workspaceContext?.workspaceId ?? null;
  const readyWorkspaceMemberId = workspaceContext?.workspaceMemberId ?? null;
  const readyScopeKey = workspaceContext
    ? workspaceIdentityCacheKey(workspaceContext)
    : null;
  const contentReadyScopeKeyRef = useRef<string | null>(null);
  if (contentReadyScopeKeyRef.current !== readyScopeKey) {
    contentReadyScopeKeyRef.current = readyScopeKey;
    contentReadyProjectIdsRef.current.clear();
    pendingContentReadyProjectIdsRef.current.clear();
    contentReadyHydrationRef.current.clear();
  }
  const acceptContentReadyProject = useCallback((
    projectId: string,
    eventWorkspaceId: string,
    eventWorkspaceMemberId: string,
  ): Promise<boolean> => {
    const workspaceId = workspaceContext?.workspaceId;
    const workspaceMemberId = workspaceContext?.workspaceMemberId;
    if (
      !workspaceId ||
      !workspaceMemberId ||
      workspaceContext?.workspaceType !== 'team' ||
      workspaceId !== eventWorkspaceId ||
      workspaceMemberId !== eventWorkspaceMemberId ||
      !teamProjectIdsRef.current.has(projectId)
    ) {
      return Promise.resolve(false);
    }
    if (contentReadyProjectIdsRef.current.has(projectId)) {
      return Promise.resolve(true);
    }
    const scopeKey = readyScopeKey;
    if (!scopeKey) return Promise.resolve(false);
    const key = `${scopeKey}:${projectId}`;
    const existing = contentReadyHydrationRef.current.get(key);
    if (existing) return existing;
    if (!onTeamProjectContentReady) return Promise.resolve(false);
    const hydration = Promise.resolve(
      onTeamProjectContentReady(projectId, workspaceId, workspaceMemberId),
    )
      .then((hydrated) => {
        if (
          hydrated !== true ||
          contentReadyScopeKeyRef.current !== scopeKey ||
          !teamProjectIdsRef.current.has(projectId)
        ) {
          return false;
        }
        pendingContentReadyProjectIdsRef.current.delete(projectId);
        contentReadyProjectIdsRef.current.add(projectId);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        if (contentReadyHydrationRef.current.get(key) === hydration) {
          contentReadyHydrationRef.current.delete(key);
        }
      });
    contentReadyHydrationRef.current.set(key, hydration);
    return hydration;
  }, [
    onTeamProjectContentReady,
    readyScopeKey,
    workspaceContext?.workspaceMemberId,
    workspaceContext?.workspaceId,
    workspaceContext?.workspaceType,
  ]);
  useWorkspaceInvalidation({
    'team-project-content-ready': ({ projectId, workspaceId }) => {
      const currentWorkspaceId = workspaceContext?.workspaceId;
      const currentWorkspaceMemberId = workspaceContext?.workspaceMemberId;
      if (
        !currentWorkspaceId ||
        !currentWorkspaceMemberId ||
        currentWorkspaceId !== workspaceId
      ) {
        return;
      }
      pendingContentReadyProjectIdsRef.current.set(projectId, {
        workspaceId,
        workspaceMemberId: currentWorkspaceMemberId,
      });
      void acceptContentReadyProject(
        projectId,
        workspaceId,
        currentWorkspaceMemberId,
      );
    },
  }, { workspaceContext });
  useEffect(() => {
    if (!readyScopeKey) return;
    for (const [projectId, eventScope] of pendingContentReadyProjectIdsRef.current) {
      if (
        eventScope.workspaceId === readyWorkspaceId &&
        eventScope.workspaceMemberId === readyWorkspaceMemberId
      ) {
        void acceptContentReadyProject(
          projectId,
          eventScope.workspaceId,
          eventScope.workspaceMemberId,
        );
      }
    }
  }, [
    acceptContentReadyProject,
    readyScopeKey,
    readyWorkspaceId,
    readyWorkspaceMemberId,
    teamProjects.projects,
  ]);
  // Open handler for the "全部项目" grid. A project already in the member's local
  // list opens directly. A remote Team project first creates an authority-bound
  // placeholder, then ProjectView opens while the daemon materializes content in
  // the background. The placeholder stamp keeps every content writer fail-closed.
  const [pullingProjectId, setPullingProjectId] = useState<string | null>(null);
  // The 全部项目 page's collection tab (OPEND-3108). The legacy `all-projects`
  // view is a deep link to the 团队项目 tab; every other entry keeps whatever
  // tab the user last picked.
  const [projectsCollection, setProjectsCollection] = useState<ProjectCollectionScope>('recent');
  useEffect(() => {
    // Entering the page from the rail opens 最近浏览过 (the Demo's strip
    // remounts on every visit, so it never carries a tab over); the legacy
    // `/all-projects` view is the one deep link that lands on 团队项目.
    if (view === 'all-projects') setProjectsCollection('teamProjects');
    else if (view === 'drafts') setProjectsCollection('recent');
  }, [view]);
  async function handleOpenAllProjects(id: string): Promise<boolean> {
    // The grid already reconciled the local row with the authoritative team
    // catalog (notably the owner's current project name). Carry its title and
    // provenance into App before navigation. Passing only the id made App reopen its local
    // SQLite placeholder ("共享项目"), throwing away data already visible on the
    // list and leaving the project header stale until a later metadata event.
    const projectName = allProjectsList.find((project) => project.id === id)?.name.trim();
    const teamProject = teamProjects.projects.find((project) => project.projectId === id);
    const localProject = projects.find((project) => project.id === id);
    const projectTitleHint = projectName
      ? {
          name: projectName,
          workspaceId: workspaceContext?.workspaceId ?? null,
          workspaceMemberId: workspaceContext?.workspaceMemberId ?? null,
          // A member must render the owner's catalog title even when their
          // local mirror has a newer timestamp or an older non-placeholder
          // title. The owner may rename locally before the catalog catches up.
          authoritative: Boolean(
            teamProject
            && teamProject.ownerMemberId !== workspaceContext?.workspaceMemberId,
          ),
        }
      : undefined;
    const open = () => Promise.resolve(onOpenProject(id, undefined, projectTitleHint));
    if (contentReadyProjectIdsRef.current.has(id)) {
      await open();
      return true;
    }
    const scopeKey = contentReadyScopeKeyRef.current;
    const hydration = scopeKey
      ? contentReadyHydrationRef.current.get(`${scopeKey}:${id}`)
      : null;
    if (hydration) {
      const hydrated = await hydration;
      if (hydrated) {
        await open();
        return true;
      }
      if (contentReadyScopeKeyRef.current !== scopeKey) return false;
    }
    // The daemon explicitly stamps the local row created by a first Team
    // status read as a placeholder. Hydrate only that stamped row before
    // navigation; a normal local Team row is already materialized and must
    // keep its direct-open path (including unpublished owner changes).
    if (
      localProject?.metadata?.sharedProjectPlaceholderAt != null
      && teamProject
      && workspaceContext?.workspaceType === 'team'
      && workspaceContext.workspaceId
      && workspaceContext.workspaceMemberId
      && onTeamProjectContentReady
    ) {
      const hydrated = await acceptContentReadyProject(
        id,
        workspaceContext.workspaceId,
        workspaceContext.workspaceMemberId,
      );
      if (hydrated) {
        await open();
        return true;
      }
    } else if (localProjectIds.has(id)) {
      await open();
      return true;
    }
    // Keep the card busy only for the short authority/bootstrap round trip, not
    // for the full content transfer. PUT is idempotent, so the sidecar may safely
    // replay it after a reused keep-alive socket resets. A paired older daemon
    // has no bootstrap route; retain the former blocking POST fallback for that
    // compatibility case.
    if (pullingProjectId) return false;
    const pullRead = beginWorkspaceScopedRead(workspaceContextRef.current);
    if (!pullRead.context) return false;
    setPullingProjectId(id);
    try {
      const collabRoute = `/api/projects/${encodeURIComponent(id)}/collab`;
      let response = await fetch(`${collabRoute}/bootstrap`, {
        method: 'PUT',
        headers: workspaceProjectHeaders(pullRead.context),
      });
      if (response.status === 404 || response.status === 405) {
        response = await fetch(`${collabRoute}/pull`, {
          method: 'POST',
          headers: workspaceProjectHeaders(pullRead.context),
        });
      }
      if (!pullRead.isStillCurrent(workspaceContextRef.current)) return false;
      if (!response.ok) return false;
      invalidateProjectFilesCache(id, pullRead.context);
      // The exact route bootstrap and ambient list refresh are independent.
      // Navigation may read the newly committed placeholder immediately while
      // the shell refreshes its catalog in parallel.
      void Promise.resolve(onProjectsRefresh?.());
    } catch {
      return false;
    } finally {
      setPullingProjectId(null);
    }
    await open();
    return true;
  }
  // Workspace-only destinations. Personal and team workspaces both use these;
  // signed-out/local state falls back to home once the context has resolved.
  // `community` is allowed in both states, so it is not guarded, and neither
  // is `drafts` any more (OPEND-3140): without a workspace it is the local
  // project list — `buildDraftsList` folds to every local project — and the
  // rail's 项目 item opens it on both branches.
  const isWorkspaceOnlyView =
    view === 'all-projects' ||
    view === 'members' ||
    view === 'board' ||
    view === 'workspace-settings';
  useEffect(() => {
    if (workspaceLoading) return;
    if (isWorkspaceOnlyView && !hasWorkspaceContext) {
      navigate({ kind: 'home', view: 'home' }, { replace: true });
    }
  }, [workspaceLoading, isWorkspaceOnlyView, hasWorkspaceContext]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // Home has NO low-balance surface, and since T66 (product 2026-09-07) neither
  // does anywhere else: a positive balance produces nothing at all and the run
  // just starts. Home reached that end state first — ruling 2026-09-06 (T53),
  // "什么都不显示,有余额就允许运行" — and the project page has now been pulled
  // level with it, so `handlePluginLoopSubmit` having no low-balance branch is
  // simply the shape of the gate: there is no such result kind to handle.
  // The entry nav rail is collapsed by default (Manus-style) so the entry
  // view opens clean and full-width; the panel toggle in the topbar opens it
  // as an overlay that dismisses on selection / backdrop click / Escape.
  // Its open/collapsed state is persisted (localStorage) so it survives a
  // home -> project -> home round trip (EntryShell unmounts on the project
  // route) and a reload, instead of snapping back to collapsed.
  const [railOpen, setRailOpen] = useState<boolean>(readStoredRailOpen);
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);

  // ⌘K / Ctrl+K opens the project search palette — same as clicking the rail
  // search box. ⌘B / Ctrl+B toggles the nav rail — same as the pinned Home
  // tab's sidebar toggle.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.isComposing
        || (
          target instanceof Element
          && target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
          )
        )
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        setProjectSearchOpen(true);
        return;
      }
      const primary = isMacPlatform()
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (
        primary &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === 'b' || event.key === 'B')
      ) {
        event.preventDefault();
        setRailOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    writeStoredRailOpen(railOpen);
    // Broadcast the state so chrome outside this tree (the pinned Home tab's
    // sidebar toggle) can mirror it via aria-expanded.
    window.dispatchEvent(
      new CustomEvent(ENTRY_RAIL_STATE_EVENT, { detail: { open: railOpen } }),
    );
  }, [railOpen]);

  // The pinned Home tab (WorkspaceTabsBar) carries a sidebar toggle; it lives
  // in a sibling tree, so the request arrives as a window event.
  useEffect(() => {
    const onToggle = () => setRailOpen((v) => !v);
    window.addEventListener(ENTRY_RAIL_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(ENTRY_RAIL_TOGGLE_EVENT, onToggle);
  }, []);
  // Same story for the search button, which sits in that chrome row beside the
  // rail toggle (per product: 搜索和收起跟 home icon 一起放在顶部) while the
  // palette it opens is owned here.
  useEffect(() => {
    const onOpen = () => setProjectSearchOpen(true);
    window.addEventListener(ENTRY_SEARCH_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ENTRY_SEARCH_OPEN_EVENT, onOpen);
  }, []);
  const [localProviderModelsCache, setLocalProviderModelsCache] =
    useState<ProviderModelsCache>({});
  const hasSharedProviderModelsCache =
    Boolean(sharedProviderModelsCache) && Boolean(onProviderModelsCacheChange);
  const activeProviderModelsCache =
    hasSharedProviderModelsCache
      ? sharedProviderModelsCache!
      : localProviderModelsCache;
  const activeSetProviderModelsCache =
    hasSharedProviderModelsCache
      ? onProviderModelsCacheChange!
      : setLocalProviderModelsCache;
  const [newProjectInitialTab, setNewProjectInitialTab] =
    useState<CreateTab>('prototype');
  const [integrationTab, setIntegrationTab] = useState<IntegrationTab>(integrationInitialTab);
  // Lazy initializer, so a handoff published by a surface that then navigated
  // here — the `/marketplace/<id>` detail route, which `App` renders outside
  // this shell — is claimed on the very first render and reaches HomeView in
  // the same commit as the mount. The read is destructive, so it applies once.
  const [homePromptHandoff, setHomePromptHandoff] = useState<HomePromptHandoff | null>(
    () => takeHomePromptHandoff(),
  );
  const entryMainScrollRef = useRef<HTMLElement | null>(null);
  // Entry views share this element, so route changes must not inherit the previous view's offset.
  useLayoutEffect(() => {
    const scrollContainer = entryMainScrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollTop = 0;
  }, [view]);
  const analytics = useAnalytics();
  // 产品拍板 D5: the campaign modal's paid 立即使用 performs the REAL switch —
  // daemon execution mode + Cloud agent (amr) + DeepSeek V4 Flash — through
  // the same persistence callbacks the InlineModelSwitcher writes through.
  // Mode must flip first: a paid user still on BYOK (`mode === 'api'`) would
  // otherwise keep the BYOK provider even after agent/model ids change.
  const applyDeepSeekCampaignModel = useCallback(
    (agentId: string, modelId: string) => {
      onModeChange('daemon');
      onAgentChange(agentId);
      onAgentModelChange(agentId, { model: modelId });
    },
    [onAgentChange, onAgentModelChange, onModeChange],
  );
  function changeView(next: EntryViewKind) {
    const navElement = navElementForView(next);
    if (navElement) {
      trackHomeNavClick(analytics.track, {
        page_name: 'home',
        area: 'nav',
        element: navElement,
      });
    }
    navigate({ kind: 'home', view: next });
  }

  // Project collection surfaces have no legacy page-level tracker. Community
  // is conditionally mounted and tracks its own visit; always-mounted library
  // surfaces receive an explicit isActive prop below.
  useEffect(() => {
    if (view === 'drafts') trackPageView(analytics.track, { page_name: 'drafts' });
    else if (view === 'all-projects') trackPageView(analytics.track, { page_name: 'all_projects' });
  }, [analytics.track, view]);

  function startPluginAuthoring(goal?: string) {
    setHomePromptHandoff(
      createPluginAuthoringHandoff(Date.now(), goal),
    );
    changeView('home');
  }

  function usePluginFromLibrary(
    record: InstalledPluginRecord,
    action: PluginUseAction = 'use',
    homeType?: { chipId: string; projectKind: ProjectKind; asExample?: boolean },
  ) {
    setHomePromptHandoff(
      createPluginUseHandoff(Date.now(), record.id, { action, ...homeType }),
    );
    changeView('home');
  }

  function useSkillFromLibrary(skill: SkillSummary) {
    setHomePromptHandoff(createSkillUseHandoff(Date.now(), skill));
    changeView('home');
  }

  useEffect(() => {
    if (view !== 'home' || !homePromptHandoff) return;
    const frame = window.requestAnimationFrame(() => {
      const scrollContainer = entryMainScrollRef.current;
      if (!scrollContainer) return;
      smoothScrollToTop(scrollContainer);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [homePromptHandoff?.id, view]);

  // The frosted top edge exists to melt content that scrolls UP under the tab
  // strip. At rest nothing is under it, but it blurred anyway — and because
  // `.entry-main__inner` starts its content at 12px, every page's h2 sat inside
  // that 32px band and read as a smudged dark block behind the title
  // (acceptance #28). Gate the blur on actually being scrolled.
  useEffect(() => {
    const scrollContainer = entryMainScrollRef.current;
    if (!scrollContainer) return;
    const sync = () => {
      scrollContainer.classList.toggle('is-scrolled', scrollContainer.scrollTop > 0);
    };
    sync();
    scrollContainer.addEventListener('scroll', sync, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', sync);
  }, [view]);

  useEffect(() => {
    setIntegrationTab(integrationInitialTab);
  }, [integrationInitialTab]);

  function openIntegrationTab(tab: IntegrationTab) {
    setIntegrationTab(tab);
    changeView('integrations');
  }

  function openNewProject(tab: CreateTab = 'prototype') {
    setNewProjectInitialTab(tab);
    setNewProjectOpen(true);
  }

  function startBlankProjectFromRail() {
    void Promise.resolve(
      onCreateProject({
        name: t('common.untitled'),
        skillId: null,
        designSystemId: null,
        // No user-typed name exists yet — mark it `generated` (the same tag
        // `handleCreateProjectFromDesignSystem` and the New Project panel's
        // blank/no-name path use) so `canAutoRenameProjectFromPrompt` stays
        // eligible once the user's first in-project prompt or the agent's
        // own generated title arrives. Without this the project is stuck at
        // "未命名" forever: this rail (the Drafts / All-projects empty-state
        // "创建" button) is the only reachable way to open a truly metadata-
        // less blank project, and every other create path already tags its
        // fallback name with a `nameSource` the rename gate recognizes.
        metadata: { kind: 'other', nameSource: 'generated' },
      }),
    ).catch((err) => {
      console.warn('Failed to create blank project from entry rail', err);
    });
  }

  function handleCreate(input: CreateInput) {
    // The NewProjectModal no longer asks the user to pick a plugin.
    // Each project kind is silently bound to its default scenario
    // pipeline at creation time so the user lands in a running flow
    // without having to reason about pipeline internals. The mapping
    // is intentionally explicit so future kind-specific scenarios
    // (e.g. a deck- or image-specialized pipeline) can take over a
    // single row without touching the form.
    const pluginId = defaultPluginIdForMetadata(input.metadata);
    const pluginInputs = defaultPluginInputsForCreate(input, pluginId);
    const { skillSelectionProvenance, ...projectInput } = input;
    const automaticStrategyRoute = skillSelectionProvenance === 'explicit-user'
      ? null
      : automaticStrategyTaskProfileForProjectMetadata(input.metadata);
    return onCreateProject({
      ...projectInput,
      // The modal's Blank card historically persisted a hidden default Skill
      // (for example agent-browser) even though the automatic scenario already
      // owns the task workflow. When OD Next replaces that scenario, carrying
      // the hidden Skill makes it look user-selected and can correctly trip
      // the planning-only validator. Keep explicit template/Skill picks exact;
      // omit only the UI's implicit default on the four automatic routes.
      ...(automaticStrategyRoute && skillSelectionProvenance === 'automatic-default'
        ? { skillId: null }
        : {}),
      ...(automaticStrategyRoute
        ? { automaticStrategyTaskProfile: automaticStrategyRoute }
        : pluginInputs
          ? { pluginInputs }
          : {}),
    });
  }

  // Plan §3.F5 — the home prompt-loop submit path. The user picks a
  // plugin (which calls /api/plugins/:id/apply and binds a snapshot),
  // edits the rendered example query if any, then presses Enter. We
  // derive a project name from the active plugin (or prompt head),
  // forward the pluginId so POST /api/projects pins the snapshot to
  // project + conversation, and request auto-send of the first
  // message so the user lands inside a running pipeline.
  //
  // Stage B of plugin-driven-flow-plan: the rail can stamp a
  // `projectKind` on the payload so the created project records the
  // chosen surface (image / video / audio, etc.). Free-form Home
  // submits now arrive with the hidden od-default router plugin and
  // projectKind='other', so the agent infers the task type and asks only
  // when the brief cannot be routed reliably.
  async function handlePluginLoopSubmit(payload: PluginLoopSubmit) {
    if (amrAuthRequired) {
      onOpenSettings();
      return 'blocked' as const;
    }
    const createInput = pluginLoopCreateInput(payload);
    const isAmrSend = config.mode === 'daemon' && config.agentId === 'amr';
    const amrModelId = isAmrSend
      ? effectiveAgentModelId(
          agents.find((agent) => agent.id === 'amr'),
          config.agentModels?.amr,
        )
      : undefined;
    // OPEND-2614: the project frame opens on the click tick for EVERY agent,
    // before any admission check. Everything below runs behind that frame —
    // this shell is unmounted the moment the hand-off navigates, so nothing
    // after this line may rely on this instance's state or DOM. App owns the
    // hand-off and the way back.
    const handoff = onBeginProjectCreation(createInput);
    // OpenDesign Cloud pre-run balance gate: hard blocks (empty wallet or
    // signed out) fire BEFORE the project is created — the dialog now sits over
    // the pending frame, and a dismiss rolls the hand-off back to Home with the
    // composer draft intact. In-project sends are gated separately in
    // ProjectView.handleSend.
    let amrGatePrecheckWitness: AmrBalanceGateScope | undefined;
    let amrGatePrecheckPassed = false;
    if (isAmrSend) {
      // PRODUCT INVARIANT: Send never starts Workspace identity discovery.
      // Billing consumes the shell's current in-memory snapshot; if it has not
      // arrived yet, the existing account-scoped gate is used. The daemon's
      // ordinary project-create route is local and does not need live Workspace
      // authority. Account/scope generation checks below only prevent a result
      // from being reused after the user switches identity while the balance
      // request or dialog is in flight.
      for (let scopeAttempt = 0; scopeAttempt < 2; scopeAttempt += 1) {
        const gateAccountGeneration = currentWorkspaceAccountGeneration();
        const gateWorkspaceState = workspaceContextStateRef.current;
        const gateWorkspaceContext = gateWorkspaceState.failure === 'unsupported'
          ? null
          : workspaceResourceReadContext(gateWorkspaceState);
        const gateWorkspaceIdentity = workspaceIdentityCacheKey(gateWorkspaceContext);
        const gateScope = amrBalanceGateScopeForWorkspaceContext(gateWorkspaceContext);
        let gate = await retryUnavailableAmrBalanceGate(
          () => checkAmrBalanceGate(gateScope, amrModelId),
        );
        // Hard blocks hold THIS submit open: the dialog resolves 'retry' when
        // its blocking condition clears (sign-in completed, recharge landed)
        // and the gate re-runs, so the task auto-continues through the normal
        // accept path. Still hard after the re-check (e.g. signed in but the
        // wallet is empty) → the dialog re-shows with the fresh snapshot.
        while (gate.kind === 'hard') {
          const blocked = gate;
          // 「哪张弹窗」和「它的主按钮去哪」问的是同一个 branch 快照,免得两次
          // 分别求值之间的一次工作区切换让两者各说各话(规格 §6.V / T58)。
          const blockedBranch = resolveAmrBalanceBranch({
            context: gateWorkspaceContext,
            billing: workspaceBilling,
          });
          const decision = await new Promise<'retry' | 'dismiss'>((resolve) => {
            onAmrBalanceGateBlockChange({
              reason: blocked.reason,
              // 被登出说的是登录不是钱,无条件走原来那张(主按钮是应用内登录,
              // 落点那一位那时用不上)。余额耗尽才按身份 × 订阅分支。
              dialog:
                blocked.reason === 'signed_out'
                  ? 'upgrade'
                  : amrBalanceBlockedDialog(blockedBranch),
              upgradeIntent:
                blocked.reason === 'signed_out'
                  ? 'pricing'
                  : amrBalanceDialogUpgradeIntent(blockedBranch),
              snapshot: blocked.snapshot,
              modelId: amrModelId,
              fundingScope: gateScope,
              resolve,
            });
          });
          onAmrBalanceGateBlockChange(null);
          if (decision === 'dismiss') {
            // The dialog was the feedback; the composer gets its draft back
            // without a second error on top.
            handoff.rollback();
            return 'blocked' as const;
          }
          gate = await retryUnavailableAmrBalanceGate(
            () => checkAmrBalanceGate(gateScope, amrModelId),
          );
        }
        if (gate.kind === 'unavailable') {
          handoff.rollback({ notice: t('home.amrGateUnavailable') });
          return false;
        }
        // Everything else falls through and the run starts. Home used to hold
        // the submit open behind a centered reminder dialog ("额度不多了" + 仍要
        // 发起任务 / 去充值). Product ruled it away on 2026-09-06 — "软提醒弹窗
        // 就是产品告诉我不要这个的" — and ruled Home's replacement to be nothing
        // at all: "什么都不显示,有余额就允许运行" (T53). T66 (2026-09-07) then
        // retired the low-balance tier everywhere, so there is no longer even a
        // result kind here to consider handling. `empty_not_blocked` also falls
        // through on purpose: it is a stood-down hard block, and Home has no
        // conversation to hang its card on. Do not re-add a branch here.
        if (
          currentWorkspaceAccountGeneration() !== gateAccountGeneration
          || workspaceIdentityCacheKey(
            workspaceContextStateRef.current.failure === 'unsupported'
              ? null
              : workspaceResourceReadContext(workspaceContextStateRef.current),
          ) !== gateWorkspaceIdentity
        ) {
          continue;
        }
        amrGatePrecheckWitness = gateScope;
        amrGatePrecheckPassed = true;
        break;
      }
      if (!amrGatePrecheckPassed) {
        handoff.rollback({ notice: t('home.createFailed') });
        return false;
      }
    }
    const create = () => Promise.resolve(onCreateProject({
      ...createInput,
      optimisticProjectId: handoff.projectId,
      ...(amrGatePrecheckWitness ? { amrGatePrecheckWitness } : {}),
    }));
    try {
      return await create();
    } catch (error) {
      if (
        error instanceof ProjectCreateError
        && error.code === 'AMR_AUTH_REQUIRED'
      ) {
        onOpenSettings();
        return 'blocked' as const;
      }
      throw error;
    }
  }

  /**
   * The create request a Home composer send turns into. Pure: it reads only
   * the payload, so it can be computed before the optimistic hand-off and
   * reused by the create that follows the admission check.
   */
  function pluginLoopCreateInput(payload: PluginLoopSubmit): EntryCreateProjectInput {
    const summarizedName = summarizeProjectNameFromPrompt(payload.prompt);
    const head = payload.prompt.trim().split(/\s+/).slice(0, 8).join(' ');
    const firstAttachmentName = payload.attachments?.[0]?.name ?? '';
    const fallbackName =
      summarizedName || (head.length > 0 ? head : firstAttachmentName || 'Untitled');
    const name =
      payload.pluginTitle && payload.pluginTitle.trim().length > 0
        ? payload.pluginTitle.trim()
        : fallbackName;
    const linkedDirs = Array.from(
      new Set(
        [
          ...(payload.workingDir ? [payload.workingDir] : []),
          ...(payload.linkedDirs ?? []),
        ].map((dir) => dir.trim()).filter(Boolean),
      ),
    );
    const metadata: ProjectMetadata = {
      ...(payload.projectMetadata ?? {}),
      kind: payload.projectKind ?? payload.projectMetadata?.kind ?? 'prototype',
      nameSource: 'prompt',
      ...(payload.contextPlugins && payload.contextPlugins.length > 0
        ? { contextPlugins: payload.contextPlugins }
        : {}),
      ...(payload.contextMcpServers && payload.contextMcpServers.length > 0
        ? { contextMcpServers: payload.contextMcpServers }
        : {}),
      ...(payload.contextConnectors && payload.contextConnectors.length > 0
        ? { contextConnectors: payload.contextConnectors }
        : {}),
      // The Home working-directory picker grants the agent read-only
      // awareness of a local folder (via `--add-dir`), it does NOT import
      // that folder into Design Files. So the picked path becomes the new
      // project's `linkedDirs` rather than its `baseDir`/`userWorkingDir`:
      // Design Files stays the managed `.od/projects/<id>` artifact store,
      // independent of the user's local files.
      ...(linkedDirs.length > 0 ? { linkedDirs } : {}),
      ...(payload.examplePromptContext ? {
        examplePrompt: true,
        examplePromptTitle: payload.examplePromptContext.title,
        examplePromptBrief: payload.examplePromptContext.brief,
      } : {}),
    };
    const strategyRoutingFields = entryStrategyRoutingFields(payload, metadata);
    return {
      name,
      ...strategyRoutingFields,
      ...(strategyRoutingFields.skillId && payload.skillCatalogScope
        ? { skillCatalogScope: payload.skillCatalogScope }
        : {}),
      designSystemId: payload.designSystemId ?? null,
      ...(payload.designSystemCatalogScope
        ? { designSystemCatalogScope: payload.designSystemCatalogScope }
        : {}),
      metadata,
      pendingPrompt: payload.prompt,
      ...(payload.pluginId && !payload.pluginSelectionProvenance
        ? { pluginId: payload.pluginId }
        : {}),
      ...(payload.pluginSource && !payload.pluginSelectionProvenance
        ? { pluginSource: payload.pluginSource }
        : {}),
      ...(payload.pluginType && !payload.pluginSelectionProvenance
        ? { pluginType: payload.pluginType }
        : {}),
      ...(payload.appliedPluginSnapshotId && !payload.pluginSelectionProvenance
        ? { appliedPluginSnapshotId: payload.appliedPluginSnapshotId }
        : {}),
      ...(payload.initialRunContext ? { initialRunContext: payload.initialRunContext } : {}),
      ...(payload.conversationMode ? { conversationMode: payload.conversationMode } : {}),
      ...(payload.attachments && payload.attachments.length > 0
        ? { pendingFiles: payload.attachments }
        : {}),
      // No `userWorkingDirToken`: linkedDirs grant read-only `--add-dir`
      // access and are validated by the daemon at create time, so they do
      // not need the desktop main-process trust token that baseDir imports
      // require for write access.
      autoSendFirstMessage: true,
    };
  }

  // This detached distribution has no trusted update feed or updater UI.
  const updaterSlot = null;

  // #5517 removes the entry top-bar settings cog: the nav-rail account menu owns
  // the settings entry (EntryNavRail onOpenSettings), so the top strip no longer
  // carries a redundant one.


  const homeExecutionSwitcher = (
    <InlineModelSwitcher
      compact
      config={config}
      agents={agents}
      providerModelsCache={activeProviderModelsCache}
      onProviderModelsCacheChange={activeSetProviderModelsCache}
      daemonLive={daemonLive}
      onModeChange={onModeChange}
      onAgentChange={onAgentChange}
      onAgentModelChange={onAgentModelChange}
      onApiProtocolChange={onApiProtocolChange}
      onApiModelChange={onApiModelChange}
      onOpenSettings={onOpenSettings}
    />
  );

  // Everything a HomeView needs except which surface it is on. Home renders
  // one as the page; the community view docks a second at its bottom, and both
  // must submit through the SAME handlers — a docked composer that created
  // projects down a second path would drift from Home's the first time either
  // changed.
  const homeViewProps = {
    projects: homeProjectsList,
    projectsLoading,
    designSystems,
    designSystemsLoading,
    defaultDesignSystemId,
    onSubmit: handlePluginLoopSubmit,
    onOpenProject,
    // The Add menu's "Add plugin" row lands on the plugins page.
    onBrowseRegistry: () => changeView('plugins'),
    onOpenIntegrations: () => openIntegrationTab('connectors'),
    onOpenMcp: () => openIntegrationTab('mcp'),
    onOpenNewProject: (tab: 'template') => {
      openNewProject(tab);
    },
    onStartBlankProject: startBlankProjectFromRail,
    projectOwnerMemberIds: teamProjectOwnerMemberIds,
    skills,
    skillsLoading,
    connectors,
    promptTemplates,
    artifactUpgradeSlot,
    deepSeekV4FlashCampaignAudience,
    onDeepSeekV4FlashCampaignUseNow: applyDeepSeekCampaignModel,
    deepSeekV4FlashCampaignMetricsConsent: config.telemetry?.metrics === true,
    deepSeekV4FlashCampaignInstallationId: config.installationId ?? null,
  };

  return (
    <div className="entry-shell entry-shell--no-header">
      <div
        className={`entry${railOpen ? ' entry--rail-open' : ''}`}
        // The team/local shell is a labeled Manus-style rail, so widen the rail
        // track (the base 56px icon-rail clips the labels + team affordances).
        style={{ ['--entry-rail-width' as string]: '236px' }}
      >
        <EntryNavRail
          view={view}
          onViewChange={changeView}
          onNewProject={() => {
            trackHomeNavClick(analytics.track, {
              page_name: 'home',
              area: 'nav',
              element: 'new_project_plus',
            });
            openNewProject();
          }}
          onOpenSearch={() => setProjectSearchOpen(true)}
          open={railOpen}
          topRightSlot={topRightCampaignAudience || (homeCampaignHostsVisible && amrLoggedIn === true) ? (
            <>
              {topRightCampaignAudience ? (
                <WorkbenchCampaignBadge
                  audience={topRightCampaignAudience}
                  page="home"
                  metricsConsent={config.telemetry?.metrics === true}
                  installationId={config.installationId}
                  loggedIn={amrLoggedIn}
                />
              ) : null}
            </>
          ) : null}
          context={railWorkspaceContext}
          billing={workspaceBilling}
          billingResponse={workspaceBillingResponse}
          balanceUsd={workspaceBalanceUsd}
          onOpenSettings={onOpenSettings}
          onInvite={() => changeView('members')}
          onSignedOut={onSignedOut}
          updaterSlot={updaterSlot}
          // A loading or unavailable workspace read is not proof of sign-out.
          // Keep the account slot neutral until Cloud answers successfully;
          // only a successful null context (or known local sign-out) may show
          // the sign-in card.
          footerNotice={accountFooterNotice}
          /* Same catalog and same opener the 全部项目 grid uses below, so the
             rail's 最近浏览过 list and that view's 最近浏览过 tab are two views of
             ONE list rather than two sorts of two lists. */
          recentProjects={projectSearchProjects}
          onOpenRecentProject={handleOpenAllProjects}
          /* Same handlers the projects grid drives its own row menu with, so a
             rename or a delete from the rail lands in exactly one place. */
          onRenameRecentProject={onRenameProject}
          onDeleteRecentProject={onDeleteProject}
          onDuplicateRecentProject={onDuplicateProject}
          /* And the same shared-state answer + optimistic markers the grids
             get, so 转入团队空间 from the rail updates every list at once. */
          isSharedRecentProject={isSharedProject}
          recentProjectOwnerMemberIds={teamProjectOwnerMemberIds}
          onRecentProjectShared={markProjectShared}
          onRecentProjectShareFailed={markProjectShareFailed}
          priorityAnnouncementActive={view === 'home' && goPlanSunsetMessagePending}
          onPriorityAnnouncementPendingChange={setGoPlanSunsetMessagePending}
          priorityAnnouncementCurrentPlanId={deepSeekCampaignPlan}
          priorityAnnouncementAmrProfile={amrProfile}
          priorityAnnouncementMetricsConsent={config.telemetry?.metrics === true}
        />
        {projectSearchOpen ? (
          <ProjectSearchModal
            // Search spans personal drafts plus the shared workspace catalog.
            // The pull-first handler still opens not-yet-local shared projects.
            projects={projectSearchProjects}
            workspaceContext={workspaceContext}
            onOpenProject={handleOpenAllProjects}
            onClose={() => setProjectSearchOpen(false)}
          />
        ) : null}
        <main className="entry-main entry-main--scroll" ref={entryMainScrollRef}>
          {/* #5517: no entry topbar. The rail toggle is the pinned Home tab in
              the workspace tabs bar (entryRailBridge), the updater popup host
              lives in the rail footer, and everything below is fixed-position
              or portalled so it occupies no layout space here. */}
          <WhatsNewPopup active={view === 'home' && !goPlanSunsetMessagePending} />
          {/* The campaign badge lives in EntryNavRail's top-right cluster so it
              stays beside the account module across every entry tab. */}
          <div
            className={[
              'entry-main__inner',
              view === 'home' ? '' : 'entry-main__inner--wide',
            ].filter(Boolean).join(' ')}
          >
            <div className="entry-main__view-home" data-testid="entry-view-home" data-active={view === 'home' ? 'true' : 'false'} {...inactiveViewProps(view === 'home')}>
              <HomeView
                {...homeViewProps}
                isActive={view === 'home'}
                /* Home is the one composer in the shell and consumes the page
                   handoff. The community view used to dock a second HomeView
                   (`variant="dock"`) with a handoff of its own; that mount
                   was taken out (OPEND-2793) until phase three gives it a
                   template-bound shape. */
                promptHandoff={homePromptHandoff}
                executionSwitcher={view === 'home' ? homeExecutionSwitcher : undefined}
              />
            </div>
            <div data-testid="entry-view-projects" data-active={view === 'projects' ? 'true' : 'false'} {...inactiveViewProps(view === 'projects')}>
              {projectsLoading || skillsLoading || designSystemsLoading ? (
                <CenteredLoader label={t('common.loading')} />
              ) : (
                <div className="entry-section">
                  <header className="entry-section__head">
                    <h1 className="entry-section__title">{t('entry.navProjects')}</h1>
                  </header>
                  <DesignsTab
                    projects={projects}
                    skills={skills}
                    designSystems={designSystems}
                    onOpen={onOpenProject}
                    onOpenLiveArtifact={onOpenLiveArtifact}
                    onDelete={onDeleteProject}
                    onDuplicate={onDuplicateProject}
                    onRename={onRenameProject}
                    onRefresh={onProjectsRefresh}
                    isActive={view === 'projects'}
                    onNewProject={() => {
                      openNewProject();
                    }}
                  />
                </div>
              )}
            </div>
            <div data-testid="entry-view-tasks" data-active={view === 'tasks' ? 'true' : 'false'} {...inactiveViewProps(view === 'tasks')}>
              <TasksView
                skills={skills}
                designTemplates={designTemplates}
                connectors={connectors}
                connectorsLoading={connectorsLoading}
                isActive={view === 'tasks'}
              />
            </div>
            <div data-testid="entry-view-plugins" data-active={view === 'plugins' ? 'true' : 'false'} {...inactiveViewProps(view === 'plugins')}>
              <ExtensionsMarketplace
                isActive={view === 'plugins'}
                onCreatePlugin={startPluginAuthoring}
                onUsePlugin={usePluginFromLibrary}
                onUseSkill={useSkillFromLibrary}
              />
            </div>
            <div data-testid="entry-view-design-systems" data-active={view === 'design-systems' ? 'true' : 'false'} {...inactiveViewProps(view === 'design-systems')}>
              {designSystemsLoading ? (
                <div className="entry-section">
                  <DesignSystemsTab
                    isActive={view === 'design-systems'}
                    loading
                    systems={[]}
                    templates={templates}
                    selectedId={defaultDesignSystemId}
                    onSelect={onChangeDefaultDesignSystem}
                    onCreate={onCreateDesignSystem}
                    onOpenSystem={onOpenDesignSystem}
                    onSystemsRefresh={onDesignSystemsRefresh}
                  />
                </div>
              ) : (
                <div className="entry-section">
                  <DesignSystemsTab
                    isActive={view === 'design-systems'}
                    systems={designSystems}
                    templates={templates}
                    selectedId={defaultDesignSystemId}
                    onSelect={onChangeDefaultDesignSystem}
                    onCreate={onCreateDesignSystem}
                    onOpenSystem={onOpenDesignSystem}
                    onSystemsRefresh={onDesignSystemsRefresh}
                  />
                </div>
              )}
            </div>
            {LIBRARY_UI_VISIBLE ? (
              <div data-testid="entry-view-library" data-active={view === 'library' ? 'true' : 'false'} {...inactiveViewProps(view === 'library')}>
                <LibrarySection
                  active={view === 'library'}
                  onOpenProject={(projectId, fileName) =>
                    navigate({ kind: 'project', projectId, conversationId: null, fileName: fileName ?? null })
                  }
                />
              </div>
            ) : null}
            <div data-testid="entry-view-brands" data-active={view === 'brands' ? 'true' : 'false'} {...inactiveViewProps(view === 'brands')}>
              <BrandsTab
                onApplyDesignSystem={onChangeDefaultDesignSystem}
                onOpenProject={onOpenProject}
                onDesignSystemsRefresh={onDesignSystemsRefresh}
              />
            </div>
            {view === 'integrations' ? (
              <IntegrationsView
                config={config}
                initialTab={integrationTab}
                composioConfigLoading={composioConfigLoading}
                onConfigPersist={onConfigPersist}
                onPersistComposioKey={onPersistComposioKey}
                onSkillsRefresh={onSkillsRefresh}
                onSkillsChanged={onSkillsChanged}
              />
            ) : null}
            {view === 'community' ? (
              <CommunityView
                onRemixTemplate={({ templateId, prompt }) => {
                  // Remix carries the template's PROJECT along, not just its
                  // prompt: duplicate the plugin's example artifact into a
                  // fresh project (the same daemon flow as the plugin
                  // gallery's 创建副本), seed the composer with the template
                  // prompt for review, then open it on the copied entry file.
                  // Templates without a duplicable artifact fall back to the
                  // old prompt-only project.
                  void (async () => {
                    const name =
                      summarizeProjectNameFromPrompt(prompt) || t('common.untitled');
                    try {
                      // One resolved authority for BOTH requests: the create
                      // binds the copied project to this workspace, and the
                      // seed patch is then authorized against that same
                      // binding. A headerless create is read by the daemon as a
                      // legacy caller and leaves the project bound to no
                      // workspace at all, which is what kept remixed projects
                      // out of the member's own 草稿 list.
                      const writeContext =
                        resolvedWorkspaceContextForWrite(workspaceContextState);
                      const result = await duplicatePluginAsProject(
                        templateId,
                        { name },
                        writeContext,
                      );
                      const seeded = await patchProject(
                        result.projectId,
                        { pendingPrompt: prompt },
                        writeContext,
                      );
                      if (!seeded) {
                        // The project itself exists and is bound — only the
                        // prompt seed was refused. Keep the user on it
                        // (retrying through the catch below would leave the
                        // copy orphaned and create a second, empty project)
                        // and surface the dropped seed instead of discarding
                        // it silently.
                        console.error('Community remix: could not seed the template prompt.');
                      }
                      await Promise.resolve(onOpenProject(result.projectId, result.relPath));
                    } catch {
                      await onCreateProject({
                        name,
                        skillId: null,
                        designSystemId: null,
                        metadata: { kind: 'other', nameSource: 'prompt' },
                        pendingPrompt: prompt,
                      });
                    }
                  })();
                }}
                onUsePrompt={(target) => {
                  // Hands off to Home (OPEND-2793, product decision B): the
                  // community view no longer docks a composer at its foot —
                  // that bar had no relation to the gallery, the filters or
                  // the card under it, and phase three will bring it back in
                  // a template-bound shape. Same seed + binding pair the
                  // standalone /community route in App.tsx uses, so Use
                  // lands the prompt AND the plugin driver in Home's composer.
                  seedHomeComposerPrompt(target.prompt);
                  setHomePromptHandoff(createPluginUseHandoff(Date.now(), target.templateId, {
                    action: 'use',
                    chipId: target.chipId,
                    projectKind: target.projectKind,
                  }));
                  changeView('home');
                }}
                // The gallery card's full details modal routes Use through the
                // same Home hand-off the plugin library uses, so the plugin
                // becomes the composer's active driver instead of only seeding
                // prompt text.
                onUsePlugin={(record, action, target) => {
                  usePluginFromLibrary(record, action, {
                    chipId: target.chipId,
                    projectKind: target.projectKind,
                    asExample: target.asExample,
                  });
                }}
              />
            ) : null}
            {/* Team destinations — the entry shell owns the nav frame only; each
                view is provided by another lane (B = members/board, D = team
                project spaces / workspace settings), rendered as a placeholder
                until those land. */}
            {view === 'drafts' || view === 'all-projects' ? (
              // 全部项目 (OPEND-3108): ONE catalog — the same list the rail's
              // 最近浏览过 shows — split by the strip's 最近浏览过 / 个人项目 /
              // 团队项目 tabs. The legacy `all-projects` view (the
              // `/all-projects` deep link) is this page opened on its 团队项目
              // tab. The team half of the catalog comes from `teamProjects`,
              // which has its own loading state and restarts from empty
              // whenever the entry shell remounts (e.g. returning from a
              // project); wait for BOTH reads before calling the page empty.
              projectsLoading || (projectSearchProjects.length === 0 && teamProjects.loading) ? (
                <div className="entry-section">
                  <CenteredLoader label={t('common.loading')} />
                </div>
              ) : projectSearchProjects.length === 0 ? (
                <EntryBlankState
                  heading={t('entry.navDrafts')}
                  description={t('entry.blankDraftsDescription')}
                  actionLabel={t('entry.blankCreate')}
                  onCreate={() => startBlankProjectFromRail()}
                />
              ) : (
                <div className="entry-section">
                  <RecentProjectsStrip
                    projects={projectSearchProjects}
                    designSystems={designSystems}
                    limit={1000}
                    heading={t('entry.navDrafts')}
                    space="drafts"
                    collection={projectsCollection}
                    onCollectionChange={setProjectsCollection}
                    isSharedProject={isSharedProject}
                    onProjectShared={markProjectShared}
                    onProjectShareFailed={markProjectShareFailed}
                    onProjectUnshared={markProjectUnshared}
                    projectOwnerMemberIds={teamProjectOwnerMemberIds}
                    openingProjectId={pullingProjectId}
                    // Pull-first opener: a 团队项目 row that is not local yet
                    // materializes before it opens, like the old team grid.
                    onOpen={handleOpenAllProjects}
                    onViewAll={() => {}}
                    onDelete={onDeleteProject}
                    onDuplicate={onDuplicateProject}
                    onRename={onRenameProject}
                    canAssignInviteRoles={workspaceContext?.permissions.canInviteMembers === true}
                    canManageProjectCollection={workspaceContext?.permissions.canShareProjects === true}
                  />
                </div>
              )
            ) : null}
            {view === 'members' ? (
              <TeamSlotPlaceholder icon="users" title={t('entry.navMembers')} />
            ) : null}
            {view === 'board' ? (
              <TeamSlotPlaceholder icon="kanban" title={t('entry.navBoard')} />
            ) : null}
            {view === 'workspace-settings' ? (
              <TeamSlotPlaceholder icon="settings" title={t('entry.navWorkspaceSettings')} />
            ) : null}
          </div>
        </main>
      </div>
      <NewProjectModal
        open={newProjectOpen}
        initialTab={newProjectInitialTab}
        skills={skills}
        designTemplates={designTemplates}
        designSystems={designSystems}
        defaultDesignSystemId={defaultDesignSystemId}
        templates={templates}
        {...(onDeleteTemplate ? { onDeleteTemplate } : {})}
        promptTemplates={promptTemplates}
        mediaProviders={config.mediaProviders}
        connectors={connectors}
        connectorsLoading={connectorsLoading}
        loading={skillsLoading}
        onCreate={handleCreate}
        onImportClaudeDesign={onImportClaudeDesign}
        {...(onImportFolder ? { onImportFolder } : {})}
        {...(onImportFolderResponse ? { onImportFolderResponse } : {})}
        onOpenConnectorsTab={() => {
          setNewProjectOpen(false);
          openIntegrationTab('connectors');
        }}
        onClose={() => setNewProjectOpen(false)}
      />
    </div>
  );
}
