import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps, useNavigate, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  RiAnchorLine,
  RiArrowRightSLine,
  RiDashboardLine,
  RiFileListLine,
  RiFolderLine,
  RiGroupLine,
  RiKey2Line,
  RiLockLine,
  RiShieldKeyholeLine,
  RiShieldUserLine,
  RiStackLine,
  RiUserLine,
} from "react-icons/ri";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { meQueryOptions } from "@/lib/auth";
import { accessibleEnvironments, useCurrentEnvironment } from "@/lib/current-env";
import { EnvironmentSwitcher } from "./environment-switcher";

const navLink =
  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-label-sm text-text-sub transition hover:bg-neutral-alpha-100 [&_svg]:size-4 [&_svg]:shrink-0";
const selected = { className: "bg-neutral-alpha-100 text-text-strong" };

function NavLink({ icon, children, ...link }: LinkProps & { icon: ReactNode; children: string }) {
  return (
    <Link {...link} className={navLink} activeProps={selected}>
      {icon}
      {children}
    </Link>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2 py-1 text-paragraph-sm text-text-soft">{label}</span>
      {children}
    </div>
  );
}

function ProjectNav({ project }: { project: string }) {
  const navigate = useNavigate();
  const projectQuery = useQuery({
    queryKey: qk.project(project),
    queryFn: () => api.projects.get(project),
  });
  const envQuery = useQuery({
    queryKey: qk.environments(project),
    queryFn: () => api.environments.list(project),
  });
  const environments = accessibleEnvironments(
    envQuery.data,
    projectQuery.data?.access?.environments,
  );
  const [current, setCurrent] = useCurrentEnvironment(environments);
  const { env: routeEnv } = useParams({ strict: false }) as { env?: string };

  const select = (slug: string) => {
    setCurrent(slug);
    if (routeEnv) {
      void navigate({
        to: "/projects/$project/environments/$env",
        params: { project, env: slug },
        search: (prev) => prev,
      });
    }
  };

  return (
    <>
      {environments && projectQuery.data ? (
        <EnvironmentSwitcher environments={environments} current={current} onSelect={select} />
      ) : (
        <div className="h-11 animate-pulse rounded-lg bg-neutral-alpha-100" />
      )}
      <Group label="Project">
        <NavLink
          to="/projects/$project"
          params={{ project }}
          activeOptions={{ exact: true, includeSearch: false }}
          icon={<RiDashboardLine />}
        >
          Overview
        </NavLink>
        {current ? (
          <NavLink
            to="/projects/$project/environments/$env"
            params={{ project, env: current }}
            activeOptions={{ includeSearch: false }}
            icon={<RiKey2Line />}
          >
            Secrets
          </NavLink>
        ) : null}
        <NavLink
          to="/projects/$project/settings/environments"
          params={{ project }}
          icon={<RiStackLine />}
        >
          Environments
        </NavLink>
        <NavLink
          to="/projects/$project/settings/members"
          params={{ project }}
          icon={<RiGroupLine />}
        >
          Members
        </NavLink>
        <NavLink
          to="/projects/$project/settings/service-tokens"
          params={{ project }}
          icon={<RiLockLine />}
        >
          Service tokens
        </NavLink>
        {projectQuery.data?.access?.role === "admin" ? (
          <NavLink
            to="/projects/$project/settings/encryption"
            params={{ project }}
            icon={<RiShieldKeyholeLine />}
          >
            Encryption
          </NavLink>
        ) : null}
        {projectQuery.data?.access?.role === "admin" ? (
          <NavLink
            to="/audit"
            search={{ projectId: projectQuery.data.id }}
            activeOptions={{ includeSearch: true }}
            icon={<RiFileListLine />}
          >
            Project audit log
          </NavLink>
        ) : null}
      </Group>
    </>
  );
}

export function Sidebar() {
  const { data: me } = useQuery(meQueryOptions);
  const { project } = useParams({ strict: false }) as { project?: string };
  const isAdmin = me?.role === "owner" || me?.role === "admin";
  return (
    <aside className="hidden w-[275px] shrink-0 flex-col gap-4 overflow-y-auto bg-neutral-alpha-50 px-3 py-3 md:flex">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-bg-strong text-white [&_svg]:size-4">
          <RiAnchorLine />
        </span>
        <span className="text-label-md text-text-strong">Anchor</span>
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-4">
        {project ? (
          <ProjectNav project={project} />
        ) : (
          <Link
            to="/projects"
            className="flex w-full items-center gap-2.5 rounded-lg bg-bg-white px-2.5 py-2 text-label-sm text-text-sub shadow-xs ring-1 ring-inset ring-stroke-soft"
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-bg-weak text-text-soft [&_svg]:size-4">
              <RiFolderLine />
            </span>
            <span className="flex-1">Select a project</span>
            <RiArrowRightSLine className="size-4 text-text-soft" />
          </Link>
        )}
        <Group label="Workspace">
          <NavLink to="/projects" activeOptions={{ exact: true }} icon={<RiFolderLine />}>
            Projects
          </NavLink>
          {isAdmin ? (
            <>
              <NavLink to="/users" icon={<RiShieldUserLine />}>
                Users
              </NavLink>
              <NavLink to="/audit" icon={<RiFileListLine />}>
                Audit log
              </NavLink>
            </>
          ) : null}
        </Group>
        <div className="mt-auto">
          <NavLink to="/account" icon={<RiUserLine />}>
            Account
          </NavLink>
        </div>
      </nav>
    </aside>
  );
}
