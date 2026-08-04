import { createClient } from '@connectrpc/connect';

import { transport } from './transport';
import { TeamService } from './gen/qfc/team/v1/team_pb.js';
import { CustomerService } from './gen/qfc/crm/v1/crm_pb.js';
import { ProjectService } from './gen/qfc/portfolio/v1/portfolio_pb.js';
import { PlanningService } from './gen/qfc/planning/v1/planning_pb.js';
import { StrategyService } from './gen/qfc/strategy/v1/strategy_pb.js';
import { GrowthService } from './gen/qfc/growth/v1/growth_pb.js';
import { EventService } from './gen/qfc/events/v1/events_pb.js';
import { SessionService } from './gen/qfc/session/v1/session_pb.js';
import { AdminService } from './gen/qfc/admin/v1/admin_pb.js';

/**
 * One Connect client per backend service, all sharing the transport in
 * `./transport`. `liveStore.tsx`, `contexts/AuthContext.tsx`, and
 * `api/useUsers.ts` are the only callers - nothing else should import
 * `./gen` or these clients directly.
 */
export const teamClient = createClient(TeamService, transport);
export const customerClient = createClient(CustomerService, transport);
export const projectClient = createClient(ProjectService, transport);
export const planningClient = createClient(PlanningService, transport);
export const strategyClient = createClient(StrategyService, transport);
export const growthClient = createClient(GrowthService, transport);
export const eventClient = createClient(EventService, transport);
export const sessionClient = createClient(SessionService, transport);
export const adminClient = createClient(AdminService, transport);
