// Server-only content bundle for programme routes. JSON is imported here (Pages bundler), never from a client island.
import rules from '../data/plan-rules.json';
import copy from './programmes/hang4.copy.json';
import { programmeRoutes } from './programme-http';

export const programmeContent = { rules, copy: copy as Record<string, any> };
export const routes = programmeRoutes(programmeContent);
