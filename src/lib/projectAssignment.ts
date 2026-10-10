import type { Project } from './types';
export function isAssignedProject(project: Project | undefined): boolean {
 return !!project && !project.isDefault && project.name.trim().toLowerCase() !== 'general';
}
export function projectLabel(project: Project | undefined): string {
 return isAssignedProject(project) ? project!.name : 'Project required';
}
