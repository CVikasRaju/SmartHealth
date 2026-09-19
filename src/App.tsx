/**
 * SmartMedic — application root.
 *
 * Mounts the store provider and routes the session to the correct role portal.
 * The portal components read `state.activeView` internally, so adding a module
 * to a role is a one-line change in `src/ui/navigation.ts` rather than another
 * branch here.
 */

import type { ComponentType } from "react";
import type { Role } from "@/types";
import { AppStoreProvider, useApp } from "@/store/AppStore";
import AppShell from "@/ui/AppShell";
import AdminPortal from "@/pages/AdminPortal";
import DoctorPortal from "@/pages/DoctorPortal";
import NursePortal from "@/pages/NursePortal";
import ReceptionPortal from "@/pages/ReceptionPortal";
import CashierPortal from "@/pages/CashierPortal";
import PatientPortal from "@/pages/PatientPortal";

const PORTALS: Record<Role, ComponentType> = {
  admin: AdminPortal,
  doctor: DoctorPortal,
  nurse: NursePortal,
  receptionist: ReceptionPortal,
  cashier: CashierPortal,
  patient: PatientPortal,
};

function PortalRouter() {
  const { state } = useApp();
  const Portal = PORTALS[state.session.role];
  return <Portal />;
}

export default function App() {
  return (
    <AppStoreProvider>
      <AppShell>
        <PortalRouter />
      </AppShell>
    </AppStoreProvider>
  );
}
