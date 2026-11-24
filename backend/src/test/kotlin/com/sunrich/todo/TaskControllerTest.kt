package com.sunrich.todo

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import jakarta.servlet.http.Cookie
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.mockito.Mockito
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*
import org.springframework.web.server.ResponseStatusException
import java.time.Instant
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@SpringBootTest(properties = [
    "spring.datasource.url=jdbc:h2:mem:todo_test;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "APP_ADMIN_USERNAME=admin",
    "APP_ADMIN_PASSWORD=TestPassword123!"
])
@AutoConfigureMockMvc
@ActiveProfiles("local")
class TaskControllerTest(
    @Autowired val mvc: MockMvc,
    @Autowired val tasks: TaskRepository,
    @Autowired val users: UserAccountRepository,
    @Autowired val employees: EmployeeRepository,
    @Autowired val encoder: PasswordEncoder,
    @Autowired val loginTokens: LoginTokenRepository,
    @Autowired val txManager: PlatformTransactionManager,
    @Autowired val taskController: TaskController
) {
    @Test
    fun plannerDateUsesKolkataAtUtcDayBoundary() {
        assertEquals(LocalDate.parse("2026-10-30"), plannerToday(Instant.parse("2026-10-29T19:00:00Z")))
    }

    @BeforeEach
    fun clean() {
        loginTokens.deleteAll()
        tasks.deleteAll()
        employees.deleteAll()
        users.findAll().filter { it.isStaff() }.forEach(users::delete)
        val admin = users.findByUsername("admin")!!
        admin.passwordHash = encoder.encode("TestPassword123!")
        users.save(admin)
        users.save(UserAccount(username = "mgr-a", displayName = "Manager A", passwordHash = "unused",
            roles = mutableSetOf(Role.DIRECTOR)))
        users.save(UserAccount(username = "mgr-b", displayName = "Manager B", passwordHash = "unused",
            roles = mutableSetOf(Role.DIRECTOR)))
    }

    private fun loginAs(username: String, password: String): Cookie = mvc.perform(post("/api/auth/login").with(csrf())
        .param("username", username).param("password", password))
        .andExpect(status().isNoContent).andReturn().response.getCookie("SUNRICH_AUTH")!!

    @Test
    fun repeatedFailedLoginsAreLimitedBeforePasswordCheck() {
        users.save(UserAccount(username = "limit-test-user", displayName = "Limit Test",
            passwordHash = encoder.encode("CorrectPassword123!"), roles = mutableSetOf(Role.DIRECTOR)))
        repeat(5) {
            mvc.perform(post("/api/auth/login").with(csrf())
                .param("username", "limit-test-user").param("password", "wrong"))
                .andExpect(status().isUnauthorized)
        }
        mvc.perform(post("/api/auth/login").with(csrf())
            .param("username", "limit-test-user").param("password", "CorrectPassword123!"))
            .andExpect(status().isTooManyRequests)
    }

    @Test
    fun typedUserHeaderCannotGrantAccess() {
        mvc.perform(get("/api/tasks").header("X-User-Id", "mgr-a"))
            .andExpect(status().isUnauthorized)
    }

    @Test
    fun taskWriteStopsWhenAccountDisappearsBeforeLock() {
        val taskRepo = Mockito.mock(TaskRepository::class.java)
        val accountRepo = Mockito.mock(UserAccountRepository::class.java)
        Mockito.`when`(accountRepo.existsByUsername("mgr-a")).thenReturn(true)
        val controller = TaskController(taskRepo, accountRepo, Mockito.mock(EmployeeRepository::class.java))
        val auth = UsernamePasswordAuthenticationToken("mgr-a", null)

        val error = assertThrows(ResponseStatusException::class.java) {
            controller.create(auth, TaskRequest(title = "Do not orphan"))
        }
        assertEquals(org.springframework.http.HttpStatus.UNAUTHORIZED, error.statusCode)
        Mockito.verifyNoInteractions(taskRepo)
    }

    @Test
    fun adminDeleteStopsWhenAccountDisappearsBeforeLock() {
        val accountRepo = Mockito.mock(UserAccountRepository::class.java)
        val taskRepo = Mockito.mock(TaskRepository::class.java)
        val account = UserAccount(id = 42, username = "mgr-a", roles = mutableSetOf(Role.DIRECTOR))
        Mockito.`when`(accountRepo.findById(42)).thenReturn(java.util.Optional.of(account))
        val controller = AdminController(accountRepo, taskRepo, encoder, Mockito.mock(PersistentLogin::class.java))

        val error = assertThrows(ResponseStatusException::class.java) { controller.delete(42) }
        assertEquals(org.springframework.http.HttpStatus.NOT_FOUND, error.statusCode)
        Mockito.verifyNoInteractions(taskRepo)
    }

    @Test
    fun duplicateUsernameRaceReturnsConflict() {
        val accountRepo = Mockito.mock(UserAccountRepository::class.java)
        Mockito.`when`(accountRepo.saveAndFlush(Mockito.any(UserAccount::class.java)))
            .thenThrow(DataIntegrityViolationException("duplicate username"))
        val controller = AdminController(accountRepo, Mockito.mock(TaskRepository::class.java), encoder,
            Mockito.mock(PersistentLogin::class.java))

        val error = assertThrows(ResponseStatusException::class.java) {
            controller.create(UserCreateRequest("same", "Manager", "LongPassword123!", setOf(Role.DIRECTOR)))
        }
        assertEquals(org.springframework.http.HttpStatus.CONFLICT, error.statusCode)
    }

    @Test
    fun renameUsernameRaceReturnsConflict() {
        val accountRepo = Mockito.mock(UserAccountRepository::class.java)
        val account = UserAccount(id = 42, username = "old", roles = mutableSetOf(Role.DIRECTOR))
        Mockito.`when`(accountRepo.findById(42)).thenReturn(java.util.Optional.of(account))
        Mockito.`when`(accountRepo.lockByUsername("old")).thenReturn(account)
        Mockito.`when`(accountRepo.saveAndFlush(account))
            .thenThrow(DataIntegrityViolationException("duplicate username"))
        val controller = AdminController(accountRepo, Mockito.mock(TaskRepository::class.java), encoder,
            Mockito.mock(PersistentLogin::class.java))

        val error = assertThrows(ResponseStatusException::class.java) {
            controller.update(42, UserUpdateRequest("new", "Manager", setOf(Role.DIRECTOR)))
        }
        assertEquals(org.springframework.http.HttpStatus.CONFLICT, error.statusCode)
    }

    @Test
    fun completedTaskCannotRetainFocusDate() {
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Finished task","status":"COMPLETED","focusDate":"2026-10-30"}"""))
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.focusDate").isEmpty)
    }

    @Test
    fun assignedTaskIsVisibleToBothAndOnlyRecipientCanComplete() {
        val recipientId = users.findByUsername("mgr-b")!!.id!!
        val created = mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Review proposal","recipientId":$recipientId}"""))
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.recipientId").value(recipientId))
            .andExpect(jsonPath("$.completedAt").isEmpty)
            .andReturn().response.contentAsString
        val id = com.jayway.jsonpath.JsonPath.read<Int>(created, "$.id")
        mvc.perform(get("/api/tasks").with(user("mgr-a").roles("DIRECTOR")))
            .andExpect(jsonPath("$[0].title").value("Review proposal"))
        mvc.perform(get("/api/tasks/history").with(user("mgr-a").roles("DIRECTOR")))
            .andExpect(jsonPath("$.totalElements").value(0))
        mvc.perform(get("/api/tasks").with(user("mgr-b").roles("DIRECTOR")))
            .andExpect(jsonPath("$[0].title").value("Review proposal"))
        mvc.perform(put("/api/tasks/$id/status").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content("""{"status":"COMPLETED"}"""))
            .andExpect(status().isNotFound)
        mvc.perform(put("/api/tasks/$id/status").with(user("mgr-b").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content("""{"status":"COMPLETED"}"""))
            .andExpect(status().isOk).andExpect(jsonPath("$.status").value("COMPLETED"))
            .andExpect(jsonPath("$.completedAt").isNotEmpty)
        mvc.perform(get("/api/tasks/history").with(user("mgr-b").roles("DIRECTOR")))
            .andExpect(jsonPath("$.totalElements").value(1))
        mvc.perform(put("/api/tasks/$id").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Review proposal","recipientId":$recipientId,"status":"ACTIVE"}"""))
            .andExpect(status().isForbidden)
        mvc.perform(post("/api/tasks").with(user("mgr-b").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Reply to manager","recipientId":${users.findByUsername("mgr-a")!!.id}}"""))
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.assignedByName").value("Manager B"))
        mvc.perform(get("/api/tasks").with(user("mgr-a").roles("DIRECTOR")))
            .andExpect(jsonPath("$.length()").value(2))
    }

    @Test
    fun senderCannotResetRecipientStatusByReassigningTask() {
        val recipientId = users.findByUsername("mgr-b")!!.id!!
        val senderId = users.findByUsername("mgr-a")!!.id!!
        val created = mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Review proposal","recipientId":$recipientId}"""))
            .andExpect(status().isCreated).andReturn().response.contentAsString
        val id = com.jayway.jsonpath.JsonPath.read<Int>(created, "$.id")
        mvc.perform(put("/api/tasks/$id/status").with(user("mgr-b").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content("""{"status":"COMPLETED"}"""))
            .andExpect(status().isOk)

        mvc.perform(put("/api/tasks/$id").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Review proposal","recipientId":$senderId,"status":"ACTIVE"}"""))
            .andExpect(status().isForbidden)
        mvc.perform(put("/api/tasks/$id").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Review proposal","recipientId":$senderId,"status":"COMPLETED"}"""))
            .andExpect(status().isForbidden)
        assertEquals(TaskStatus.COMPLETED, tasks.findById(id.toLong()).orElseThrow().status)
    }

    @Test
    fun senderCanReassignTaskWithoutChangingRecipientStatus() {
        val recipientId = users.findByUsername("mgr-b")!!.id!!
        val senderId = users.findByUsername("mgr-a")!!.id!!
        val created = mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Review proposal","recipientId":$recipientId}"""))
            .andExpect(status().isCreated).andReturn().response.contentAsString
        val id = com.jayway.jsonpath.JsonPath.read<Int>(created, "$.id")
        mvc.perform(put("/api/tasks/$id/status").with(user("mgr-b").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content("""{"status":"IN_PROGRESS"}"""))
            .andExpect(status().isOk)

        mvc.perform(put("/api/tasks/$id").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Review proposal","recipientId":$senderId,"status":"IN_PROGRESS"}"""))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.recipientId").value(senderId))
            .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
    }

    @Test
    fun taskReassignedToItsCreatorHasNoAssignedByLabel() {
        val recipientId = users.findByUsername("mgr-b")!!.id!!
        val senderId = users.findByUsername("mgr-a")!!.id!!
        val created = mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Review proposal","recipientId":$recipientId}"""))
            .andExpect(status().isCreated).andReturn().response.contentAsString
        val id = com.jayway.jsonpath.JsonPath.read<Int>(created, "$.id")

        mvc.perform(put("/api/tasks/$id").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Review proposal","recipientId":$senderId,"status":"ACTIVE"}"""))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.assignedByName").isEmpty)
    }

    @Test
    fun recipientMustBeSeniorManagementAndAssignedTaskSurvivesSenderDeletion() {
        val recipientId = users.findByUsername("mgr-b")!!.id!!
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content("""{"title":"Invalid","recipientId":999999}"""))
            .andExpect(status().isBadRequest)
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content("""{"title":"Admin only","recipientId":${users.findByUsername("admin")!!.id}}"""))
            .andExpect(status().isBadRequest)
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content("""{"title":"Persistent","recipientId":$recipientId}"""))
            .andExpect(status().isCreated)
        val senderId = users.findByUsername("mgr-a")!!.id!!
        mvc.perform(delete("/api/admin/users/$senderId").with(user("admin").roles("SUPER_ADMIN")).with(csrf()))
            .andExpect(status().isNoContent)
        mvc.perform(get("/api/tasks").with(user("mgr-b").roles("DIRECTOR")))
            .andExpect(jsonPath("$[0].title").value("Persistent"))
            .andExpect(jsonPath("$[0].assignedByName").value("Manager A"))
        val transferredId = tasks.findAllByUserIdOrderByCreatedAtDesc("mgr-b").first().id!!
        mvc.perform(put("/api/tasks/$transferredId").with(user("mgr-b").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Persistent edited","recipientId":$recipientId,"status":"ACTIVE"}"""))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.assignedByName").value("Manager A"))
    }

    @Test
    fun oversizedTaskTitleIsRejectedBeforeDatabaseWrite() {
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"${"T".repeat(256)}"}"""))
            .andExpect(status().isBadRequest)
        assertEquals(0, tasks.count())
    }

    @Test
    fun oversizedNotesAreRejectedBeforeDatabaseWrite() {
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Briefing","notes":"${"N".repeat(16001)}"}"""))
            .andExpect(status().isBadRequest)
        assertEquals(0, tasks.count())
    }

    @Test
    fun managersCannotAccessEachOthersTasks() {
        repeat(3) { i ->
            mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"title":"Task $i","focusDate":"2026-10-30"}"""))
                .andExpect(status().isCreated)
        }
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Task 4","focusDate":"2026-10-30"}"""))
            .andExpect(status().isBadRequest)

        val list = mvc.perform(get("/api/tasks").with(user("mgr-b").roles("DIRECTOR")))
            .andExpect(status().isOk).andReturn().response.contentAsString
        assertEquals("[]", list)

        val id = tasks.findAllByUserIdOrderByCreatedAtDesc("mgr-a").first().id!!
        mvc.perform(put("/api/tasks/$id").with(user("mgr-b").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content("""{"title":"Stolen"}"""))
            .andExpect(status().isNotFound)
        mvc.perform(delete("/api/tasks/$id").with(user("mgr-b").roles("DIRECTOR")).with(csrf()))
            .andExpect(status().isNotFound)
    }

    @Test
    fun adminSignsInAndManagesManagers() {
        val cookie = loginAs("admin", "TestPassword123!")
        mvc.perform(get("/api/auth/me").cookie(cookie))
            .andExpect(status().isOk).andExpect(jsonPath("$.roles[0]").value("SUPER_ADMIN"))
        mvc.perform(post("/api/admin/users").cookie(cookie).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"username":"new","displayName":"New Manager","password":"LongPassword123!","roles":["DIRECTOR"]}"""))
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.username").value("new"))
            .andExpect(jsonPath("$.roles[0]").value("DIRECTOR"))
        mvc.perform(get("/api/admin/users").with(user("mgr-a").roles("DIRECTOR")))
            .andExpect(status().isForbidden)
        mvc.perform(get("/api/tasks").cookie(cookie)).andExpect(status().isForbidden)
    }

    @Test
    fun loginSurvivesBrowserRestartWithoutHttpSessionAndLogoutRevokesIt() {
        val login = mvc.perform(post("/api/auth/login").with(csrf())
            .param("username", "admin").param("password", "TestPassword123!"))
            .andExpect(status().isNoContent).andReturn()
        val cookie = login.response.getCookie("SUNRICH_AUTH")
        assertNotNull(cookie)
        assertEquals(30 * 24 * 60 * 60, cookie!!.maxAge)
        assertNull(login.request.getSession(false))
        mvc.perform(get("/api/auth/me").cookie(cookie))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.username").value("admin"))
        mvc.perform(post("/api/auth/logout").cookie(cookie).with(csrf()))
            .andExpect(status().isNoContent)
        mvc.perform(get("/api/auth/me").cookie(cookie))
            .andExpect(status().isUnauthorized)
    }

    @Test
    fun badCredentialsAndMissingCsrfCannotCreateAnAccount() {
        mvc.perform(post("/api/auth/login").with(csrf())
            .param("username", "admin").param("password", "wrong-password"))
            .andExpect(status().isUnauthorized)
        assertEquals(0, loginTokens.count())

        val cookie = loginAs("admin", "TestPassword123!")
        mvc.perform(post("/api/admin/users").cookie(cookie)
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"username":"forged","displayName":"Forged","password":"Password123!","roles":["DIRECTOR"]}"""))
            .andExpect(status().isForbidden)
        assertNull(users.findByUsername("forged"))
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isOk)
    }

    @Test
    fun expiredPersistentLoginCannotAccessTheApi() {
        val cookie = loginAs("admin", "TestPassword123!")
        val token = loginTokens.findAll().single()
        token.expiresAt = Instant.now().minusSeconds(1)
        loginTokens.save(token)
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isUnauthorized)
        mvc.perform(get("/api/admin/users").cookie(cookie)).andExpect(status().isUnauthorized)
    }

    @Test
    fun signedInManagerGetsForbiddenForAdminApiWithoutLosingLogin() {
        val manager = users.findByUsername("mgr-a")!!
        manager.passwordHash = encoder.encode("ManagerPassword123!")
        users.save(manager)
        val cookie = loginAs("mgr-a", "ManagerPassword123!")
        mvc.perform(get("/api/admin/users").cookie(cookie)).andExpect(status().isForbidden)
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isOk)
    }

    @Test
    fun renamingAndDeletingAnAccountRevokeItsPersistentLogin() {
        val manager = users.findByUsername("mgr-a")!!
        manager.passwordHash = encoder.encode("ManagerPassword123!")
        users.save(manager)
        val oldCookie = loginAs("mgr-a", "ManagerPassword123!")
        mvc.perform(put("/api/admin/users/${manager.id}").with(user("admin").roles("SUPER_ADMIN")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"username":"renamed-a","displayName":"Manager A","roles":["DIRECTOR"]}"""))
            .andExpect(status().isOk)
        mvc.perform(get("/api/auth/me").cookie(oldCookie)).andExpect(status().isUnauthorized)

        val newCookie = loginAs("renamed-a", "ManagerPassword123!")
        mvc.perform(get("/api/tasks").cookie(newCookie)).andExpect(status().isOk)
        mvc.perform(delete("/api/admin/users/${manager.id}").with(user("admin").roles("SUPER_ADMIN")).with(csrf()))
            .andExpect(status().isNoContent)
        mvc.perform(get("/api/auth/me").cookie(newCookie)).andExpect(status().isUnauthorized)
    }

    @Test
    fun createUserRejectsTwoSeniorManagementRoles() {
        val cookie = loginAs("admin", "TestPassword123!")
        mvc.perform(post("/api/admin/users").cookie(cookie).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"username":"two","displayName":"Two Roles","password":"LongPassword123!","roles":["DIRECTOR","CHAIRMAN"]}"""))
            .andExpect(status().isBadRequest)
        // SUPER_ADMIN alongside one senior role is allowed.
        mvc.perform(post("/api/admin/users").cookie(cookie).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"username":"combo","displayName":"Combo","password":"LongPassword123!","roles":["CHAIRMAN","SUPER_ADMIN"]}"""))
            .andExpect(status().isCreated)
    }

    @Test
    fun inProgressTaskIsOpenKeepsFocusAndIsFilterable() {
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"WIP item","status":"IN_PROGRESS","focusDate":"2026-10-30"}"""))
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
            .andExpect(jsonPath("$.focusDate").value("2026-10-30"))
        mvc.perform(get("/api/tasks/history").with(user("mgr-a").roles("DIRECTOR"))
            .param("status", "IN_PROGRESS"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.totalElements").value(1))
    }

    @Test
    fun employeesAreListedAndTaggedOnTasks() {
        val cookie = loginAs("admin", "TestPassword123!")
        val empJson = mvc.perform(post("/api/admin/employees").cookie(cookie).with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content("""{"name":"Alice Field"}"""))
            .andExpect(status().isCreated).andReturn().response.contentAsString
        val empId = com.jayway.jsonpath.JsonPath.read<Int>(empJson, "$.id")
        // Any signed-in manager can read the list to populate the picker.
        mvc.perform(get("/api/employees").with(user("mgr-a").roles("DIRECTOR")))
            .andExpect(status().isOk).andExpect(jsonPath("$[0].name").value("Alice Field"))
        // Tagging an employee on a task round-trips.
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Prep board deck","assigneeIds":[$empId]}"""))
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.assigneeIds[0]").value(empId))
    }

    @Test
    fun deletingEmployeeRemovesTheirTaskTags() {
        val employee = employees.save(Employee(name = "Former employee"))
        val task = tasks.save(Task(userId = "mgr-a", title = "Board deck",
            assigneeIds = mutableListOf(employee.id!!)))

        mvc.perform(delete("/api/admin/employees/${employee.id}").with(user("admin").roles("SUPER_ADMIN")).with(csrf()))
            .andExpect(status().isNoContent)

        assertEquals(emptyList<Long>(), tasks.findById(task.id!!).orElseThrow().assigneeIds)
    }

    @Test
    fun deletingEmployeeKeepsConcurrentTaskCompletion() {
        val employee = employees.save(Employee(name = "Former employee"))
        val task = tasks.save(Task(userId = "mgr-a", title = "Board deck",
            assigneeIds = mutableListOf(employee.id!!)))
        val locked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val deletionStarted = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val completion = pool.submit {
                TransactionTemplate(txManager).executeWithoutResult {
                    val held = tasks.lockById(task.id!!)!!
                    held.status = TaskStatus.COMPLETED
                    held.completedAt = Instant.now()
                    locked.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                }
            }
            check(locked.await(5, TimeUnit.SECONDS))
            val deletion = pool.submit {
                deletionStarted.countDown()
                mvc.perform(delete("/api/admin/employees/${employee.id}")
                    .with(user("admin").roles("SUPER_ADMIN")).with(csrf()))
                    .andExpect(status().isNoContent)
            }
            check(deletionStarted.await(5, TimeUnit.SECONDS))
            Thread.sleep(200)
            release.countDown()
            completion.get(5, TimeUnit.SECONDS)
            deletion.get(5, TimeUnit.SECONDS)
            val saved = tasks.findById(task.id!!).orElseThrow()
            assertEquals(TaskStatus.COMPLETED, saved.status)
            assertEquals(emptyList<Long>(), saved.assigneeIds)
        } finally {
            release.countDown()
            pool.shutdownNow()
        }
    }

    @Test
    fun taggingTaskWaitsForEmployeeDeletion() {
        val employee = employees.save(Employee(name = "Former employee"))
        val locked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val taggingStarted = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val deletion = pool.submit {
                TransactionTemplate(txManager).executeWithoutResult {
                    val held = employees.lockByIdForWrite(employee.id!!)!!
                    locked.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                    employees.delete(held)
                }
            }
            check(locked.await(5, TimeUnit.SECONDS))
            val tagging = pool.submit(java.util.concurrent.Callable {
                taggingStarted.countDown()
                mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"title":"Board deck","assigneeIds":[${employee.id}]}"""))
                    .andReturn().response.status
            })
            check(taggingStarted.await(5, TimeUnit.SECONDS))
            Thread.sleep(200)
            assertEquals(false, tagging.isDone, "Tagging must wait for employee deletion")
            release.countDown()
            deletion.get(5, TimeUnit.SECONDS)
            assertEquals(400, tagging.get(5, TimeUnit.SECONDS))
            assertEquals(0, tasks.count())
        } finally {
            release.countDown()
            pool.shutdownNow()
        }
    }

    @Test
    fun taskRejectsEmployeeTagsThatDoNotExist() {
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Board deck","assigneeIds":[999999]}"""))
            .andExpect(status().isBadRequest)
        assertEquals(0, tasks.count())

        val task = tasks.save(Task(userId = "mgr-a", title = "Existing task"))
        mvc.perform(put("/api/tasks/${task.id}").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Existing task","assigneeIds":[999999]}"""))
            .andExpect(status().isBadRequest)
        assertEquals(emptyList<Long>(), tasks.findById(task.id!!).orElseThrow().assigneeIds)
    }

    @Test
    fun completionWaitsForConcurrentTaskEdit() {
        val task = tasks.save(Task(userId = "mgr-a", title = "Original"))
        val firstLocked = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        val secondStarted = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val edit = pool.submit {
                TransactionTemplate(txManager).executeWithoutResult {
                    val held = tasks.findByIdAndUserId(task.id!!, "mgr-a")!!
                    held.title = "Edited"
                    firstLocked.countDown()
                    check(releaseFirst.await(5, TimeUnit.SECONDS))
                }
            }
            check(firstLocked.await(5, TimeUnit.SECONDS))
            val completion = pool.submit {
                secondStarted.countDown()
                mvc.perform(put("/api/tasks/${task.id}/status").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
                    .contentType(MediaType.APPLICATION_JSON).content("""{"status":"COMPLETED"}"""))
                    .andExpect(status().isOk)
            }
            check(secondStarted.await(5, TimeUnit.SECONDS))
            Thread.sleep(200)
            assertEquals(false, completion.isDone, "Completion must wait for the edit to commit")
            releaseFirst.countDown()
            edit.get(5, TimeUnit.SECONDS)
            completion.get(5, TimeUnit.SECONDS)
            val saved = tasks.findById(task.id!!).orElseThrow()
            assertEquals("Edited", saved.title)
            assertEquals(TaskStatus.COMPLETED, saved.status)
        } finally {
            releaseFirst.countDown()
            pool.shutdownNow()
        }
    }

    @Test
    fun assignmentWaitsForRecipientDeletion() {
        val recipientId = users.findByUsername("mgr-b")!!.id!!
        val locked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val started = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val deletion = pool.submit {
                TransactionTemplate(txManager).executeWithoutResult {
                    val recipient = users.lockByUsername("mgr-b")!!
                    locked.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                    users.delete(recipient)
                }
            }
            check(locked.await(5, TimeUnit.SECONDS))
            val assignment = pool.submit(java.util.concurrent.Callable {
                started.countDown()
                mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""{"title":"New assignment","recipientId":$recipientId}"""))
                    .andReturn().response.status
            })
            check(started.await(5, TimeUnit.SECONDS))
            Thread.sleep(200)
            assertEquals(false, assignment.isDone, "Assignment must wait for recipient deletion")
            release.countDown()
            deletion.get(5, TimeUnit.SECONDS)
            assertEquals(400, assignment.get(5, TimeUnit.SECONDS))
            assertEquals(0, tasks.count())
        } finally {
            release.countDown()
            pool.shutdownNow()
        }
    }

    @Test
    fun assignmentWaitsForLowerAccountBeforeLockingHigherAccount() {
        val accounts = listOf(users.findByUsername("mgr-a")!!, users.findByUsername("mgr-b")!!)
            .sortedBy { it.id }
        val low = accounts[0]
        val high = accounts[1]
        val lowLocked = CountDownLatch(1)
        val releaseLow = CountDownLatch(1)
        val assignmentStarted = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(3)
        try {
            val holder = pool.submit {
                TransactionTemplate(txManager).executeWithoutResult {
                    users.lockByIdForWrite(low.id!!)!!
                    lowLocked.countDown()
                    check(releaseLow.await(5, TimeUnit.SECONDS))
                }
            }
            check(lowLocked.await(5, TimeUnit.SECONDS))
            val assignment = pool.submit {
                TransactionTemplate(txManager).executeWithoutResult {
                    assignmentStarted.countDown()
                    taskController.lockParticipants(UsernamePasswordAuthenticationToken(high.username, null), low.id)
                }
            }
            check(assignmentStarted.await(5, TimeUnit.SECONDS))
            Thread.sleep(200)
            assertEquals(false, assignment.isDone)
            val highProbe = pool.submit {
                TransactionTemplate(txManager).executeWithoutResult {
                    users.lockByIdForWrite(high.id!!)!!
                }
            }
            highProbe.get(2, TimeUnit.SECONDS)
            releaseLow.countDown()
            holder.get(5, TimeUnit.SECONDS)
            assignment.get(5, TimeUnit.SECONDS)
        } finally {
            releaseLow.countDown()
            pool.shutdownNow()
        }
    }

    @Test
    fun deletingSenderKeepsConcurrentRecipientCompletion() {
        val sender = users.findByUsername("mgr-a")!!
        val recipient = users.findByUsername("mgr-b")!!
        val task = tasks.save(Task(userId = sender.username, recipientId = recipient.id,
            assignedByName = sender.displayName, title = "Review"))
        val locked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val deletionStarted = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val completion = pool.submit {
                TransactionTemplate(txManager).executeWithoutResult {
                    val held = tasks.lockById(task.id!!)!!
                    held.status = TaskStatus.COMPLETED
                    held.completedAt = Instant.now()
                    locked.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                }
            }
            check(locked.await(5, TimeUnit.SECONDS))
            val deletion = pool.submit {
                deletionStarted.countDown()
                mvc.perform(delete("/api/admin/users/${sender.id}")
                    .with(user("admin").roles("SUPER_ADMIN")).with(csrf()))
                    .andExpect(status().isNoContent)
            }
            check(deletionStarted.await(5, TimeUnit.SECONDS))
            Thread.sleep(200)
            release.countDown()
            completion.get(5, TimeUnit.SECONDS)
            deletion.get(5, TimeUnit.SECONDS)
            assertEquals(TaskStatus.COMPLETED, tasks.findById(task.id!!).orElseThrow().status)
        } finally {
            release.countDown()
            pool.shutdownNow()
        }
    }

    @Test
    fun profileEditCannotUndoConcurrentPasswordChange() {
        val oldHash = encoder.encode("OldPassword123!")
        val newHash = encoder.encode("NewPassword123!")
        val manager = users.findByUsername("mgr-a")!!
        manager.passwordHash = oldHash
        users.save(manager)
        val locked = CountDownLatch(1)
        val release = CountDownLatch(1)
        val profileStarted = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val passwordChange = pool.submit {
                TransactionTemplate(txManager).executeWithoutResult {
                    val held = users.lockByUsername("mgr-a")!!
                    held.passwordHash = newHash
                    locked.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                }
            }
            check(locked.await(5, TimeUnit.SECONDS))
            val profileEdit = pool.submit {
                profileStarted.countDown()
                mvc.perform(put("/api/auth/profile").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
                    .contentType(MediaType.APPLICATION_JSON).content("""{"displayName":"Updated Name"}"""))
                    .andExpect(status().isOk)
            }
            check(profileStarted.await(5, TimeUnit.SECONDS))
            Thread.sleep(200)
            release.countDown()
            passwordChange.get(5, TimeUnit.SECONDS)
            profileEdit.get(5, TimeUnit.SECONDS)
            val saved = users.findByUsername("mgr-a")!!
            assertEquals("Updated Name", saved.displayName)
            assertEquals(newHash, saved.passwordHash)
        } finally {
            release.countDown()
            pool.shutdownNow()
        }
    }

    @Test
    fun taskHistoryIsPagedAndFilteredPerManager() {
        repeat(3) { i ->
            tasks.save(Task(userId = "mgr-a", title = "Board $i"))
        }
        tasks.save(Task(userId = "mgr-b", title = "Other manager"))
        mvc.perform(get("/api/tasks/history").with(user("mgr-a").roles("DIRECTOR"))
            .param("page", "0").param("size", "2").param("search", "Board"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.content.length()").value(2))
            .andExpect(jsonPath("$.totalElements").value(3))
    }

    @Test
    fun historySortsPriorityAndTreatsSearchSymbolsLiterally() {
        tasks.save(Task(userId = "mgr-a", title = "Rate 100%", priority = Priority.LOW))
        tasks.save(Task(userId = "mgr-a", title = "Rate 100", priority = Priority.HIGH))
        tasks.save(Task(userId = "mgr-a", title = "Medium item", priority = Priority.MEDIUM))
        mvc.perform(get("/api/tasks/history").with(user("mgr-a").roles("DIRECTOR"))
            .param("sort", "PRIORITY"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.content[0].priority").value("HIGH"))
            .andExpect(jsonPath("$.content[1].priority").value("MEDIUM"))
            .andExpect(jsonPath("$.content[2].priority").value("LOW"))
        mvc.perform(get("/api/tasks/history").with(user("mgr-a").roles("DIRECTOR"))
            .param("search", "%"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.totalElements").value(1))
    }

    @Test
    fun prioritySortUsesNewestWithinPriorityBeforePaging() {
        tasks.save(Task(userId = "mgr-a", title = "Newest", priority = Priority.HIGH,
            createdAt = Instant.parse("2026-01-03T00:00:00Z")))
        tasks.save(Task(userId = "mgr-a", title = "Middle", priority = Priority.HIGH,
            createdAt = Instant.parse("2026-01-02T00:00:00Z")))
        tasks.save(Task(userId = "mgr-a", title = "Oldest", priority = Priority.HIGH,
            createdAt = Instant.parse("2026-01-01T00:00:00Z")))
        mvc.perform(get("/api/tasks/history").with(user("mgr-a").roles("DIRECTOR"))
            .param("sort", "PRIORITY").param("size", "2"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.totalElements").value(3))
            .andExpect(jsonPath("$.content[0].title").value("Newest"))
    }

    @Test
    fun expiredFocusDoesNotOutrankCurrentHighPriorityTask() {
        tasks.save(Task(userId = "mgr-a", title = "Old focus", priority = Priority.MEDIUM,
            focusDate = plannerToday().minusDays(1)))
        tasks.save(Task(userId = "mgr-a", title = "High today", priority = Priority.HIGH))
        mvc.perform(get("/api/tasks/history").with(user("mgr-a").roles("DIRECTOR"))
            .param("sort", "PRIORITY"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.content[0].title").value("High today"))
    }

    @Test
    fun historyHasStableOrderWhenTasksShareATimestamp() {
        val sameTime = Instant.parse("2026-01-03T00:00:00Z")
        tasks.save(Task(userId = "mgr-a", title = "First", priority = Priority.HIGH, createdAt = sameTime))
        tasks.save(Task(userId = "mgr-a", title = "Second", priority = Priority.HIGH, createdAt = sameTime))
        for (sort in listOf("NEWEST", "PRIORITY")) {
            mvc.perform(get("/api/tasks/history").with(user("mgr-a").roles("DIRECTOR"))
                .param("sort", sort).param("page", "0").param("size", "1"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.content[0].title").value("Second"))
            mvc.perform(get("/api/tasks/history").with(user("mgr-a").roles("DIRECTOR"))
                .param("sort", sort).param("page", "1").param("size", "1"))
                .andExpect(status().isOk)
                .andExpect(jsonPath("$.content[0].title").value("First"))
        }
    }

    @Test
    fun changingPasswordRevokesTheOldLogin() {
        val cookie = loginAs("admin", "TestPassword123!")
        mvc.perform(post("/api/auth/password").cookie(cookie).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"currentPassword":"TestPassword123!","newPassword":"ChangedPassword123!"}"""))
            .andExpect(status().isNoContent)
        mvc.perform(get("/api/auth/me").cookie(cookie)).andExpect(status().isUnauthorized)
    }

    @Test
    fun changingRolesRevokesTheOldLogin() {
        val manager = users.findByUsername("mgr-a")!!
        manager.roles = mutableSetOf(Role.DIRECTOR, Role.SUPER_ADMIN)
        manager.passwordHash = encoder.encode("ManagerPassword123!")
        users.save(manager)
        val cookie = loginAs(manager.username, "ManagerPassword123!")
        mvc.perform(get("/api/admin/users").cookie(cookie)).andExpect(status().isOk)
        mvc.perform(put("/api/admin/users/${manager.id}").with(user("admin").roles("SUPER_ADMIN")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"username":"mgr-a","displayName":"Manager A","roles":["DIRECTOR"]}"""))
            .andExpect(status().isOk)
        mvc.perform(get("/api/admin/users").cookie(cookie)).andExpect(status().isUnauthorized)
    }

    @Test
    fun managerTasksSurviveSignOutAndSignIn() {
        val manager = users.findByUsername("mgr-a")!!
        manager.passwordHash = encoder.encode("ManagerPassword123!")
        users.save(manager)
        val firstCookie = loginAs(manager.username, "ManagerPassword123!")
        mvc.perform(post("/api/tasks").cookie(firstCookie).with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content("""{"title":"Private task"}"""))
            .andExpect(status().isCreated)
        mvc.perform(post("/api/auth/logout").cookie(firstCookie).with(csrf()))
            .andExpect(status().isNoContent)
        val secondCookie = loginAs(manager.username, "ManagerPassword123!")
        mvc.perform(get("/api/tasks").cookie(secondCookie))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].title").value("Private task"))
    }

    @Test
    fun editingManagerUsernameMovesTasksAndDeletingManagerRemovesThem() {
        val manager = users.findByUsername("mgr-a")!!
        tasks.save(Task(userId = manager.username, title = "Existing task"))
        mvc.perform(put("/api/admin/users/${manager.id}").with(user("admin").roles("SUPER_ADMIN")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"username":"renamed","displayName":"Renamed Manager","roles":["DIRECTOR"]}"""))
            .andExpect(status().isOk)
        assertEquals(0, tasks.findAllByUserIdOrderByCreatedAtDesc("mgr-a").size)
        assertEquals(1, tasks.findAllByUserIdOrderByCreatedAtDesc("renamed").size)
        mvc.perform(delete("/api/admin/users/${manager.id}").with(user("admin").roles("SUPER_ADMIN")).with(csrf()))
            .andExpect(status().isNoContent)
        assertEquals(0, tasks.findAllByUserIdOrderByCreatedAtDesc("renamed").size)
    }

    @Test
    fun deletingManagerRemovesSelfAddressedTasksWithoutLeavingOrphans() {
        val manager = users.findByUsername("mgr-a")!!
        mvc.perform(post("/api/tasks").with(user("mgr-a").roles("DIRECTOR")).with(csrf())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""{"title":"Self-addressed","recipientId":${manager.id}}"""))
            .andExpect(status().isCreated)
        mvc.perform(delete("/api/admin/users/${manager.id}").with(user("admin").roles("SUPER_ADMIN")).with(csrf()))
            .andExpect(status().isNoContent)
        assertEquals(0, tasks.findAllByUserIdOrderByCreatedAtDesc("mgr-a").size)
    }
}
