export type V2SupervisorListSource = {
  uid: string;
  fullName: string;
  email: string;
  phone: string | null;
  authority: "root" | "regular";
  status: "active" | "inactive";
  revision: number;
};

export type V2RootSupervisorListItem = V2SupervisorListSource;
export type V2RegularSupervisorListItem = Pick<V2SupervisorListSource, "uid" | "fullName" | "authority">;

export function projectV2SupervisorList(supervisors: V2SupervisorListSource[], viewerAuthority: "root" | "regular"): Array<V2RootSupervisorListItem | V2RegularSupervisorListItem> {
  if (viewerAuthority === "root") return supervisors;
  return supervisors
    .filter((supervisor) => supervisor.status === "active")
    .map(({ uid, fullName, authority }) => ({ uid, fullName, authority }));
}
