//! `ProjectService`: project master data, stored as encoded-proto blob rows
//! (`store::Table::Project`). See `services::crud` for the shared
//! list/upsert/delete machinery every plain blob-backed entity service uses.

use connectrpc::{RequestContext, Response, ServiceRequest, ServiceResult};
use sqlx::SqlitePool;

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::events::Hub;
use crate::proto::events::EntityKind;
use crate::proto::portfolio::{
    DeleteProjectRequest, DeleteProjectResponse, ListProjectsRequest, ListProjectsResponse,
    Project, ProjectService, UpsertProjectRequest, UpsertProjectResponse,
};
use crate::services::crud;
use crate::store::Table;

pub struct ProjectServiceImpl {
    pool: SqlitePool,
    hub: Hub,
}

impl ProjectServiceImpl {
    pub fn new(pool: SqlitePool, hub: Hub) -> Self {
        Self { pool, hub }
    }
}

impl ProjectService for ProjectServiceImpl {
    async fn list_projects(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, ListProjectsRequest>,
    ) -> ServiceResult<ListProjectsResponse> {
        let projects = crud::list(&self.pool, Table::Project).await?;
        Response::ok(ListProjectsResponse {
            projects,
            ..Default::default()
        })
    }

    async fn upsert_project(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertProjectRequest>,
    ) -> ServiceResult<UpsertProjectResponse> {
        let current = auth::require(&ctx)?;
        let entity = request
            .to_owned_message()
            .project
            .into_option()
            .unwrap_or_default();
        let spec = crud::EntitySpec {
            table: Table::Project,
            kind: EntityKind::Project,
            name: "project",
        };
        let project = crud::upsert(
            &self.pool,
            &self.hub,
            &spec,
            &current.email,
            entity,
            |p: &mut Project| &mut p.id,
            validate_project,
        )
        .await?;
        Response::ok(UpsertProjectResponse {
            project: project.into(),
            ..Default::default()
        })
    }

    async fn delete_project(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteProjectRequest>,
    ) -> ServiceResult<DeleteProjectResponse> {
        let current = auth::require(&ctx)?;
        let spec = crud::EntitySpec {
            table: Table::Project,
            kind: EntityKind::Project,
            name: "project",
        };
        crud::delete(&self.pool, &self.hub, &spec, &current.email, request.id).await?;
        Response::ok(DeleteProjectResponse::default())
    }
}

fn validate_project(project: &Project) -> AppResult<()> {
    if project.name.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "project.name must not be empty".to_string(),
        ));
    }
    Ok(())
}
