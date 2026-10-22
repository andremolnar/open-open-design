/** A loading budget is not a live-document budget. All browsing covers share
 * this owner so even rapid switches can retain at most one running page. */
export const PREVIEW_HOVER_DELAY_MS = 350;
export const PREVIEW_LEAVE_GRACE_MS = 900;

export function createProjectPreviewHover() {
  type Card = { notify(active: boolean): void; disposed: boolean };
  let active: Card | null = null;
  let candidate: Card | null = null;
  let enterTimer: ReturnType<typeof setTimeout> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelEntry = () => {
    clearTimeout(enterTimer);
    enterTimer = undefined;
    candidate = null;
  };
  const deactivate = () => {
    clearTimeout(leaveTimer);
    leaveTimer = undefined;
    const previous = active;
    active = null;
    previous?.notify(false);
  };
  return {
    suspend() { cancelEntry(); deactivate(); },
    register(notify: (active: boolean) => void) {
      const card: Card = { notify, disposed: false };
      return {
        enter() {
          if (card.disposed) return;
          cancelEntry();
          if (active === card) {
            clearTimeout(leaveTimer);
            leaveTimer = undefined;
            return;
          }
          candidate = card;
          enterTimer = setTimeout(() => {
            if (candidate !== card || card.disposed) return;
            cancelEntry();
            deactivate();
            active = card;
            card.notify(true);
          }, PREVIEW_HOVER_DELAY_MS);
        },
        leave() {
          if (candidate === card) cancelEntry();
          if (active !== card) return;
          clearTimeout(leaveTimer);
          leaveTimer = setTimeout(() => {
            if (active === card) deactivate();
          }, PREVIEW_LEAVE_GRACE_MS);
        },
        release() {
          if (candidate === card) cancelEntry();
          if (active === card) deactivate();
        },
        dispose() {
          if (candidate === card) cancelEntry();
          if (active === card) deactivate();
          card.disposed = true;
        },
      };
    },
  };
}

export const projectPreviewHover = createProjectPreviewHover();
