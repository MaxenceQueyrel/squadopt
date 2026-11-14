import { Check, CircleAlert } from "lucide-react";
import { Pill } from "@/components/common/ui";
import { skillLevel } from "@/components/projects/staffing";
import type { Person, SkillRequirement } from "@/types";

/** A pill with the person's level in a required skill: green when it meets the minimum,
 * amber when it falls short or the person lacks the skill. */
export function SkillMatch({
  person,
  requirement,
}: {
  person: Person;
  requirement: SkillRequirement;
}) {
  const level = person.skills.find((s) => s.id === requirement.id)?.level;
  if (skillLevel(person, requirement.id) >= requirement.min_level) {
    return (
      <Pill tone="success" icon={Check}>
        {requirement.id} <span className="mono">{level ?? 0}</span>
      </Pill>
    );
  }
  return (
    <Pill tone="warning" icon={CircleAlert}>
      {level === undefined ? (
        `no ${requirement.id}`
      ) : (
        <>
          {requirement.id} <span className="mono">{level}</span>
        </>
      )}
    </Pill>
  );
}
