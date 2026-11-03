import { RegistryContext } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { use, useRef, useSyncExternalStore } from "react";
import * as Schema from "effect/Schema";
import { useLocalStorage } from "../../hooks/useLocalStorage";

const MODE_KEY = "t3code.project-worktrees.v1.enabled";
const PREFERENCES_KEY = "t3code.project-worktrees.v1.preferences";
const Preferences = Schema.Struct({
  selectedProject: Schema.String,
  lastMembers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  lastThreads: Schema.Record(Schema.String, Schema.String),
  lastDestinations: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  expanded: Schema.Record(Schema.String, Schema.Boolean),
  pinned: Schema.Record(Schema.String, Schema.Boolean),
});
const DEFAULT_PREFERENCES: typeof Preferences.Type = {
  selectedProject: "",
  lastThreads: {},
  expanded: {},
  pinned: {},
};

export function useProjectNavigationEnabled() {
  return useLocalStorage(MODE_KEY, false, Schema.Boolean);
}

export function useProjectNavigationPreferences() {
  return useLocalStorage(PREFERENCES_KEY, DEFAULT_PREFERENCES, Preferences);
}

function subscribeDocumentVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function useDocumentVisible() {
  return useSyncExternalStore(
    subscribeDocumentVisibility,
    () => document.visibilityState !== "hidden",
  );
}

export function useNavigationQueryWhileVisible<A>(atom: Atom.Atom<A>, visible: boolean): A {
  const registry = use(RegistryContext);
  const held = useRef<{ readonly atom: Atom.Atom<A>; readonly value: A } | null>(null);
  return useSyncExternalStore(
    (onChange) => (visible ? registry.subscribe(atom, onChange) : () => undefined),
    () => {
      if (visible || held.current === null || held.current.atom !== atom)
        held.current = { atom, value: registry.get(atom) };
      return held.current.value;
    },
  );
}
