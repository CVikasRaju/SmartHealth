/**
 * SmartMedic — application root.
 *
 * Three states, in order: the credential check, the record load, then the role
 * portal. Nothing that displays clinical data is mounted until the API has
 * returned a profile, so an unauthenticated browser never holds a snapshot it
 * could render.
 *
 * The portal components read `state.activeView` internally, so adding a module
 * to a role is a one-line change in `src/ui/navigation.ts` rather than another
 * branch here.
 */

import type { ComponentType } from "react";
import type { Role } from "@/types";
import { SessionProvider, useSession } from "@/store/SessionProvider";
import { AppStoreProvider, useApp } from "@/store/AppStore";
import AppShell from "@/ui/AppShell";
import BootScreen from "@/ui/BootScreen";
import LoginPage from "@/pages/LoginPage";
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

function AppGate() {
  const { status } = useSession();

  if (status === "loading") {
    return <BootScreen title="Checking the session" detail="Verifying the credentials held by this browser." />;
  }

  if (status === "signed_out") {
    return <LoginPage />;
  }

  return (
    <AppStoreProvider>
      <AppShell>
        <PortalRouter />
      </AppShell>
    </AppStoreProvider>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <AppGate />
    </SessionProvider>
  );
}
