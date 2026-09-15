export type SupervisorListSource = {
  uid: string;
  fullName: string;
  email: string;
  phone: string | null;
  authority: "root" | "regular";
  status: "active" | "inactive";
  revision: number;
};

export type RootSupervisorListItem = SupervisorListSource;
export type RegularSupervisorListItem = Pick<SupervisorListSource, "uid" | "fullName" | "authority">;

export function projectSupervisorList(supervisors: SupervisorListSource[], viewerAuthority: "root" | "regular"): Array<RootSupervisorListItem | RegularSupervisorListItem> {
  if (viewerAuthority === "root") return supervisors;
  return supervisors
    .filter((supervisor) => supervisor.status === "active")
    .map(({ uid, fullName, authority }) => ({ uid, fullName, authority }));
}
