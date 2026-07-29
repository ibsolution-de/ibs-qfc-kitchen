fn main() {
    connectrpc_build::Config::new()
        .files(&[
            "../proto/qfc/admin/v1/admin.proto",
            "../proto/qfc/crm/v1/crm.proto",
            "../proto/qfc/events/v1/events.proto",
            "../proto/qfc/growth/v1/growth.proto",
            "../proto/qfc/planning/v1/planning.proto",
            "../proto/qfc/portfolio/v1/portfolio.proto",
            "../proto/qfc/session/v1/session.proto",
            "../proto/qfc/strategy/v1/strategy.proto",
            "../proto/qfc/team/v1/team.proto",
        ])
        .includes(&["../proto"])
        .include_file("_connectrpc.rs")
        .compile()
        .unwrap();

    // The per-file rerun-if-changed directives above only cover the files
    // listed in `.files()`; watch the whole proto directory too so adding,
    // removing, or renaming a `.proto` file also triggers a rebuild.
    println!("cargo:rerun-if-changed=../proto");
}
