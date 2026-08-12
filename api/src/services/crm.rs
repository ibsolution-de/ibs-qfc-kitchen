//! `CustomerService`: customer master data, stored as encoded-proto blob
//! rows (`store::Table::Customer`). See `services::crud` for the shared
//! list/upsert/delete machinery every plain blob-backed entity service uses.

use connectrpc::{RequestContext, Response, ServiceRequest, ServiceResult};
use sqlx::SqlitePool;

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::events::Hub;
use crate::proto::crm::{
    Customer, CustomerService, DeleteCustomerRequest, DeleteCustomerResponse, ListCustomersRequest,
    ListCustomersResponse, UpsertCustomerRequest, UpsertCustomerResponse,
};
use crate::proto::events::EntityKind;
use crate::proto::session::UserRole;
use crate::services::crud;
use crate::store::Table;

pub struct CustomerServiceImpl {
    pool: SqlitePool,
    hub: Hub,
}

impl CustomerServiceImpl {
    pub fn new(pool: SqlitePool, hub: Hub) -> Self {
        Self { pool, hub }
    }
}

impl CustomerService for CustomerServiceImpl {
    async fn list_customers(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, ListCustomersRequest>,
    ) -> ServiceResult<ListCustomersResponse> {
        let customers = crud::list(&self.pool, Table::Customer).await?;
        Response::ok(ListCustomersResponse {
            customers,
            ..Default::default()
        })
    }

    async fn upsert_customer(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertCustomerRequest>,
    ) -> ServiceResult<UpsertCustomerResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl, UserRole::Sales])?;
        let entity = request
            .to_owned_message()
            .customer
            .into_option()
            .unwrap_or_default();
        let spec = crud::EntitySpec {
            table: Table::Customer,
            kind: EntityKind::Customer,
            name: "customer",
        };
        let customer = crud::upsert(
            &self.pool,
            &self.hub,
            &spec,
            &current.email,
            entity,
            |c: &mut Customer| &mut c.id,
            validate_customer,
        )
        .await?;
        Response::ok(UpsertCustomerResponse {
            customer: customer.into(),
            ..Default::default()
        })
    }

    async fn delete_customer(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteCustomerRequest>,
    ) -> ServiceResult<DeleteCustomerResponse> {
        let current = auth::require_any_role(&ctx, &[UserRole::Pm, UserRole::Bl, UserRole::Sales])?;
        let spec = crud::EntitySpec {
            table: Table::Customer,
            kind: EntityKind::Customer,
            name: "customer",
        };
        crud::delete(&self.pool, &self.hub, &spec, &current.email, request.id).await?;
        Response::ok(DeleteCustomerResponse::default())
    }
}

fn validate_customer(customer: &Customer) -> AppResult<()> {
    if customer.name.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "customer.name must not be empty".to_string(),
        ));
    }
    if customer.email.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "customer.email must not be empty".to_string(),
        ));
    }
    Ok(())
}
