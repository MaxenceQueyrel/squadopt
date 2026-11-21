import { CircleAlert, Pencil, Plus, Trash } from "lucide-react";
import { useState } from "react";
import { Button, Card, colors, Menu, type MenuItem, SearchInput } from "@/components/common/ui";
import {
  type CatalogItem,
  type CatalogKind,
  CatalogModal,
  catalogNouns,
} from "@/components/people/CatalogModal";
import { formatHeadcount } from "@/components/projects/staffing";
import { errorMessage, rolesApi, skillsApi, tagsApi } from "@/services/api";
import { useAppStore } from "@/store";
import { useAuthStore } from "@/store/authStore";

const headerCell = {
  padding: "0.6rem 0.75rem",
  textAlign: "left",
  fontSize: "0.82rem",
  fontWeight: 500,
  color: colors.muted,
  borderBottom: `1px solid ${colors.border}`,
} as const;

const bodyCell = {
  padding: "0.7rem 0.75rem",
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: "top",
} as const;

const catalogApis = { role: rolesApi, skill: skillsApi, tag: tagsApi };

/** The catalog tab: the full role, skill and tag catalogs with their descriptions. */
export default function PeopleCatalogView() {
  const {
    people,
    projects,
    roles,
    skills,
    tags,
    createRole,
    createSkill,
    createTag,
    fetchPeople,
    fetchProjects,
    fetchRoles,
    fetchSkills,
    fetchTags,
  } = useAppStore();
  const canWriteRoles = useAuthStore((s) => s.permissions.has("roles:write"));
  const canDeleteRoles = useAuthStore((s) => s.permissions.has("roles:delete"));
  const canWriteSkills = useAuthStore((s) => s.permissions.has("skills:write"));
  const canDeleteSkills = useAuthStore((s) => s.permissions.has("skills:delete"));
  // Tags have no permission codes of their own: they are part of a person's profile.
  const canWriteTags = useAuthStore((s) => s.permissions.has("people:write"));
  const [editing, setEditing] = useState<{ kind: CatalogKind; item?: CatalogItem } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalogs = {
    role: { items: roles, create: createRole, fetch: fetchRoles },
    skill: { items: skills, create: createSkill, fetch: fetchSkills },
    tag: { items: tags, create: createTag, fetch: fetchTags },
  };

  const save = async (
    { kind, item }: { kind: CatalogKind; item?: CatalogItem },
    data: { id: string; description: string },
  ) => {
    if (item) {
      await catalogApis[kind].update(item.id, data);
      await catalogs[kind].fetch();
    } else {
      await catalogs[kind].create(data);
    }
    setEditing(null);
  };

  const remove = async (kind: CatalogKind, id: string, warning: string) => {
    if (!confirm(`Delete ${kind} ${id}?${warning}`)) return;
    setError(null);
    try {
      await catalogApis[kind].delete(id);
      await catalogs[kind].fetch();
      // The backend strips a deleted tag from every person and project exclusion that had it.
      if (kind === "tag") await Promise.all([fetchPeople(), fetchProjects()]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const stillSetOn = (usedBy: number) =>
    usedBy > 0 ? ` It is still set on ${formatHeadcount(usedBy)}.` : "";

  // Deleting a tag removes it from everything that carries it, so the prompt names all of it.
  const tagRemovalWarning = (id: string) => {
    const usages: string[] = [];
    const holders = people.filter((p) => p.tags.includes(id)).length;
    if (holders > 0) usages.push(formatHeadcount(holders));
    const excluding = projects.filter((p) => p.excluded_tags.includes(id)).length;
    if (excluding > 0) usages.push(`${excluding} ${excluding === 1 ? "project" : "projects"}`);
    return usages.length > 0 ? ` It will be removed from ${usages.join(" and ")}.` : "";
  };

  return (
    <div>
      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            marginBottom: "1rem",
            padding: "0.6rem 0.9rem",
            borderRadius: "var(--radius)",
            background: colors.dangerBg,
            color: colors.danger,
            fontSize: "0.875rem",
          }}
        >
          <CircleAlert size={16} aria-hidden />
          {error}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "1.25rem",
          alignItems: "start",
        }}
      >
        <CatalogSection
          kind="role"
          title="Roles"
          subtitle="Labels you pick from on the person form."
          items={roles}
          usage={(id) => people.filter((p) => p.role === id).length}
          canWrite={canWriteRoles}
          canDelete={canDeleteRoles}
          onAdd={() => setEditing({ kind: "role" })}
          onEdit={(item) => setEditing({ kind: "role", item })}
          onDelete={(id, usedBy) => remove("role", id, stillSetOn(usedBy))}
        />
        <CatalogSection
          kind="skill"
          title="Skills"
          subtitle="Skill ids you rate people on and require on projects."
          items={skills}
          usage={(id) => people.filter((p) => p.skills.some((s) => s.id === id)).length}
          canWrite={canWriteSkills}
          canDelete={canDeleteSkills}
          onAdd={() => setEditing({ kind: "skill" })}
          onEdit={(item) => setEditing({ kind: "skill", item })}
          onDelete={(id, usedBy) => remove("skill", id, stillSetOn(usedBy))}
        />
        <CatalogSection
          kind="tag"
          title="Tags"
          subtitle="Labels for groups of people, such as External, that projects can exclude."
          items={tags}
          usage={(id) => people.filter((p) => p.tags.includes(id)).length}
          canWrite={canWriteTags}
          canDelete={canWriteTags}
          onAdd={() => setEditing({ kind: "tag" })}
          onEdit={(item) => setEditing({ kind: "tag", item })}
          onDelete={(id) => remove("tag", id, tagRemovalWarning(id))}
        />
      </div>

      {editing && (
        <CatalogModal
          kind={editing.kind}
          items={catalogs[editing.kind].items}
          item={editing.item}
          onClose={() => setEditing(null)}
          onSave={(data) => save(editing, data)}
        />
      )}
    </div>
  );
}

function CatalogSection({
  kind,
  title,
  subtitle,
  items,
  usage,
  canWrite,
  canDelete,
  onAdd,
  onEdit,
  onDelete,
}: {
  kind: CatalogKind;
  title: string;
  subtitle: string;
  items: CatalogItem[];
  usage: (id: string) => number;
  canWrite: boolean;
  canDelete: boolean;
  onAdd: () => void;
  onEdit: (item: CatalogItem) => void;
  onDelete: (id: string, usedBy: number) => void;
}) {
  const noun = catalogNouns[kind];
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter(
        (item) =>
          item.id.toLowerCase().includes(needle) ||
          item.description?.toLowerCase().includes(needle),
      )
    : items;
  return (
    <Card style={{ padding: "1.25rem 1.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>
            {title}{" "}
            <span className="mono" style={{ color: colors.muted, fontSize: "0.9rem" }}>
              {needle ? `${visible.length} of ${items.length}` : items.length}
            </span>
          </h3>
          <p style={{ margin: "0.3rem 0 0", color: colors.muted, fontSize: "0.88rem" }}>
            {subtitle}
          </p>
        </div>
        {canWrite && (
          <Button icon={Plus} ariaLabel={`Add ${kind}`} onClick={onAdd}>
            {noun}
          </Button>
        )}
      </div>
      {(items.length > 0 || query) && (
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={`Search ${kind}s`}
          style={{ marginBottom: "0.75rem" }}
        />
      )}
      {items.length === 0 ? (
        <p style={{ margin: 0, color: colors.muted, fontSize: "0.9rem" }}>No {kind}s yet.</p>
      ) : visible.length === 0 ? (
        <p style={{ margin: 0, color: colors.muted, fontSize: "0.9rem" }}>
          No {kind}s match "{query.trim()}".
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                <th style={headerCell}>{noun}</th>
                <th style={headerCell}>Description</th>
                <th style={{ ...headerCell, textAlign: "right" }}>People</th>
                <th style={headerCell} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const usedBy = usage(item.id);
                const actions: MenuItem[] = [];
                if (canWrite)
                  actions.push({
                    label: "Edit description",
                    icon: Pencil,
                    onSelect: () => onEdit(item),
                  });
                if (canDelete)
                  actions.push({
                    label: "Delete",
                    icon: Trash,
                    danger: true,
                    onSelect: () => onDelete(item.id, usedBy),
                  });
                return (
                  <tr key={item.id}>
                    <td style={{ ...bodyCell, fontWeight: 500, overflowWrap: "anywhere" }}>
                      {item.id}
                    </td>
                    <td
                      style={{ ...bodyCell, color: item.description ? colors.text : colors.subtle }}
                    >
                      {item.description || "—"}
                    </td>
                    <td
                      className="mono"
                      style={{
                        ...bodyCell,
                        textAlign: "right",
                        color: usedBy === 0 ? colors.warningText : colors.text,
                      }}
                    >
                      {usedBy}
                    </td>
                    <td style={{ ...bodyCell, width: 1, padding: "0.4rem 0.25rem" }}>
                      {actions.length > 0 && (
                        <Menu items={actions} ariaLabel={`Actions for ${kind} ${item.id}`} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
