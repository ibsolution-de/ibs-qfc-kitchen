//! `TeamService`: employee master data, stored as encoded-proto blob rows
//! (`store::Table::Employee`). See `services::crud` for the shared
//! list/upsert/delete machinery every plain blob-backed entity service uses.

use connectrpc::{RequestContext, Response, ServiceRequest, ServiceResult};
use sqlx::SqlitePool;

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::events::Hub;
use crate::proto::events::EntityKind;
use crate::proto::team::{
    DeleteEmployeeRequest, DeleteEmployeeResponse, Employee, ListEmployeesRequest,
    ListEmployeesResponse, TeamService, UpsertEmployeeRequest, UpsertEmployeeResponse,
};
use crate::services::crud;
use crate::store::Table;

pub struct TeamServiceImpl {
    pool: SqlitePool,
    hub: Hub,
}

impl TeamServiceImpl {
    pub fn new(pool: SqlitePool, hub: Hub) -> Self {
        Self { pool, hub }
    }
}

impl TeamService for TeamServiceImpl {
    async fn list_employees(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, ListEmployeesRequest>,
    ) -> ServiceResult<ListEmployeesResponse> {
        let employees = crud::list(&self.pool, Table::Employee).await?;
        Response::ok(ListEmployeesResponse {
            employees,
            ..Default::default()
        })
    }

    async fn upsert_employee(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertEmployeeRequest>,
    ) -> ServiceResult<UpsertEmployeeResponse> {
        let current = auth::require(&ctx)?;
        let entity = request
            .to_owned_message()
            .employee
            .into_option()
            .unwrap_or_default();
        let spec = crud::EntitySpec {
            table: Table::Employee,
            kind: EntityKind::Employee,
            name: "employee",
        };
        let employee = crud::upsert(
            &self.pool,
            &self.hub,
            &spec,
            &current.email,
            entity,
            |e: &mut Employee| &mut e.id,
            validate_employee,
        )
        .await?;
        Response::ok(UpsertEmployeeResponse {
            employee: employee.into(),
            ..Default::default()
        })
    }

    async fn delete_employee(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteEmployeeRequest>,
    ) -> ServiceResult<DeleteEmployeeResponse> {
        let current = auth::require(&ctx)?;
        let spec = crud::EntitySpec {
            table: Table::Employee,
            kind: EntityKind::Employee,
            name: "employee",
        };
        crud::delete(&self.pool, &self.hub, &spec, &current.email, request.id).await?;
        Response::ok(DeleteEmployeeResponse::default())
    }
}

fn validate_employee(employee: &Employee) -> AppResult<()> {
    if employee.name.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "employee.name must not be empty".to_string(),
        ));
    }
    Ok(())
}
