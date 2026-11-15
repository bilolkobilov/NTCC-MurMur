import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { doctorApi } from "../../api/doctor";
import { ErrorState, SkeletonRows } from "../../components/ui/States";
import { DoctorProfileView } from "./DoctorProfileView";

/** The doctor's own profile ("My profile"). Read-only: name and clinic are managed by the administrator. */
export function MyProfilePage() {
  const { t } = useTranslation();
  const profile = useQuery({ queryKey: ["profile"], queryFn: doctorApi.myProfile });
  const patients = useQuery({
    queryKey: ["patients", { q: "", sort: "recent", status: "all" }, "profile"],
    queryFn: () => doctorApi.listPatients({ q: "", sort: "recent", status: "all" }),
  });
  const activity = useQuery({ queryKey: ["profile", "activity"], queryFn: doctorApi.myActivity });

  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <SkeletonRows rows={4} label={t("common.loading")} />;
  return (
    <DoctorProfileView
      viewer="doctor"
      profile={profile.data}
      patients={patients.data ? { kind: "own", rows: patients.data } : undefined}
      activity={activity.data}
      actions={null}
    />
  );
}
