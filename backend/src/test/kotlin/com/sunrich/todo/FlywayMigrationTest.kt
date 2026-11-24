package com.sunrich.todo

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.ActiveProfiles
import java.sql.DriverManager

@SpringBootTest(properties = [
    "spring.datasource.url=jdbc:h2:mem:flyway_validation;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
    "spring.jpa.hibernate.ddl-auto=validate",
    "spring.flyway.enabled=true",
    "APP_ADMIN_USERNAME=flyway-admin",
    "APP_ADMIN_PASSWORD=TestPassword123!"
])
@ActiveProfiles("local")
class FlywayMigrationTest(@Autowired val tasks: TaskRepository) {
    @Test
    fun appStartsAgainstMigratedSchema() {
        assertEquals(0, tasks.count())
    }

    @Test
    fun initialMigrationCreatesTaskAndAccountTables() {
        val url = "jdbc:h2:mem:flyway_schema;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"
        val flyway = Flyway.configure().dataSource(url, "sa", "").load()
        assertEquals(2, flyway.migrate().migrationsExecuted)
        DriverManager.getConnection(url, "sa", "").use { connection ->
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT COUNT(*) FROM users").use { result ->
                    result.next()
                    assertEquals(0, result.getInt(1))
                }
                statement.executeQuery("SELECT COUNT(*) FROM tasks").use { result ->
                    result.next()
                    assertEquals(0, result.getInt(1))
                }
                statement.executeQuery("SELECT COUNT(*) FROM login_tokens").use { result ->
                    result.next()
                    assertEquals(0, result.getInt(1))
                }
            }
        }
    }
}
