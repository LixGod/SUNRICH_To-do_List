package com.sunrich.todo

import jakarta.persistence.*
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.JpaSpecificationExecutor
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.domain.PageRequest
import org.springframework.data.jpa.domain.Specification
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

fun plannerToday(now: Instant = Instant.now()): LocalDate = now.atZone(ZoneId.of("Asia/Kolkata")).toLocalDate()

@SpringBootApplication
class TodoApplication

fun main(args: Array<String>) {
    runApplication<TodoApplication>(*args)
}

enum class Priority { HIGH, MEDIUM, LOW }
enum class TaskStatus { ACTIVE, IN_PROGRESS, COMPLETED }
enum class TaskSort { NEWEST, PRIORITY }

// Assignee ids live in a single scalar column (CSV) so task paging needs no collection join.
@Converter
class LongListConverter : AttributeConverter<MutableList<Long>, String> {
    override fun convertToDatabaseColumn(attribute: MutableList<Long>?): String =
        attribute?.joinToString(",") ?: ""
    override fun convertToEntityAttribute(dbData: String?): MutableList<Long> =
        dbData?.split(",")?.mapNotNull { it.trim().toLongOrNull() }?.toMutableList() ?: mutableListOf()
}

@Entity
@Table(
    name = "tasks",
    indexes = [
        Index(name = "idx_tasks_user_status", columnList = "userId, status"),
        Index(name = "idx_tasks_recipient_status", columnList = "recipientId, status")
    ]
)
class Task(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null,

    @Column(nullable = false)
    var userId: String = "",
    var recipientId: Long? = null,
    var assignedByName: String? = null,

    @field:NotBlank(message = "Title is required")
    @Column(nullable = false)
    var title: String = "",

    @Column(columnDefinition = "TEXT")
    var notes: String? = null,

    var dueTime: LocalTime? = null,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    var priority: Priority = Priority.MEDIUM,

    var category: String? = null,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    var status: TaskStatus = TaskStatus.ACTIVE,

    var focusDate: LocalDate? = null,

    // Employees tagged on this task as a reminder of who is involved (they have no portal access).
    @Convert(converter = LongListConverter::class)
    @Column(columnDefinition = "TEXT")
    var assigneeIds: MutableList<Long> = mutableListOf(),

    @Column(nullable = false, updatable = false)
    var createdAt: Instant = Instant.now(),

    @Column(nullable = false)
    var updatedAt: Instant = Instant.now(),
    var completedAt: Instant? = null
)

interface TaskRepository : JpaRepository<Task, Long>, JpaSpecificationExecutor<Task> {
    fun findAllByUserIdOrRecipientIdOrderByCreatedAtDesc(userId: String, recipientId: Long): List<Task>
    fun findAllByUserIdOrderByCreatedAtDesc(userId: String): List<Task>
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from Task t where t.userId = :userId order by t.createdAt desc")
    fun lockAllByUserId(userId: String): List<Task>
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from Task t order by t.id")
    fun lockAllForEmployeeCleanup(): List<Task>
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    fun findByIdAndUserId(id: Long, userId: String): Task?
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from Task t where t.id = :id")
    fun lockById(id: Long): Task?
    fun countByUserIdAndFocusDateAndStatusNot(userId: String, focusDate: LocalDate, status: TaskStatus): Long
    @Modifying
    @Query("update Task t set t.userId = :newEmail where t.userId = :oldEmail")
    fun moveUserTasks(oldEmail: String, newEmail: String): Int
    @Modifying
    @Query("update Task t set t.recipientId = null where t.recipientId = :recipientId")
    fun clearRecipient(recipientId: Long): Int
}

data class TaskRequest(
    @field:NotBlank(message = "Title is required")
    @field:Size(max = 255)
    val title: String,
    @field:Size(max = 16000) val notes: String? = null,
    val recipientId: Long? = null,
    val dueTime: LocalTime? = null,
    val priority: Priority = Priority.MEDIUM,
    @field:Size(max = 255) val category: String? = null,
    val status: TaskStatus = TaskStatus.ACTIVE,
    val focusDate: LocalDate? = null,
    val assigneeIds: List<Long> = emptyList()
)

data class TaskPageResponse(val content: List<Task>, val totalElements: Long, val number: Int)
data class StatusRequest(val status: TaskStatus)

@RestController
@RequestMapping("/api/tasks")
class TaskController(
    private val repo: TaskRepository,
    private val users: UserAccountRepository,
    private val employees: EmployeeRepository
) {

    private fun currentUser(auth: Authentication): String =
        auth.name.takeIf { users.existsByUsername(it) }
            ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Account is no longer available.")

    private fun lockedUser(auth: Authentication): UserAccount =
        users.lockByUsername(auth.name)
            ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Account is no longer available.")

    internal fun lockParticipants(auth: Authentication, recipientId: Long?): Pair<UserAccount, UserAccount?> {
        if (recipientId == null) return lockedUser(auth) to null
        val ownerId = users.findByUsername(auth.name)?.id
            ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Account is no longer available.")
        val locked = listOf(ownerId, recipientId).distinct().sorted()
            .associateWith { users.lockByIdForWrite(it) }
        val owner = locked[ownerId]?.takeIf { it.username == auth.name }
            ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Account is no longer available.")
        val recipient = locked[recipientId]?.takeIf(UserAccount::isStaff)
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a Senior Management recipient.")
        return owner to recipient
    }

    private fun enforceFocusLimit(userId: String, focusDate: LocalDate?, status: TaskStatus, exclude: Task? = null) {
        if (focusDate != null && status != TaskStatus.COMPLETED) {
            val currentFocused = repo.countByUserIdAndFocusDateAndStatusNot(userId, focusDate, TaskStatus.COMPLETED) -
                if (exclude?.focusDate == focusDate && exclude.status != TaskStatus.COMPLETED) 1 else 0
            if (currentFocused >= 3) {
                throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Today's Focus allows up to 3 active tasks per day.")
            }
        }
    }

    private fun validateEmployeeTags(ids: List<Long>) {
        if (ids.size != ids.distinct().size || ids.sorted().any { employees.lockById(it) == null }) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose employees from the directory.")
        }
    }

    @GetMapping
    fun list(auth: Authentication, @RequestParam(required = false) status: TaskStatus?): List<Task> =
        users.findByUsername(currentUser(auth))!!.let { account ->
            repo.findAllByUserIdOrRecipientIdOrderByCreatedAtDesc(account.username, account.id!!)
                .filter { status == null || it.status == status }
        }

    @GetMapping("/recipients")
    fun recipients(auth: Authentication): List<AccountView> {
        currentUser(auth)
        return users.findAll().filter { it.isStaff() }.sortedBy { it.displayName }.map { it.view() }
    }

    @GetMapping("/history")
    fun history(
        auth: Authentication,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "50") size: Int,
        @RequestParam(required = false) status: TaskStatus?,
        @RequestParam(required = false) search: String?,
        @RequestParam(required = false) priority: Priority?,
        @RequestParam(required = false) category: String?,
        @RequestParam(defaultValue = "NEWEST") sort: TaskSort
    ): TaskPageResponse {
        val account = users.findByUsername(currentUser(auth))!!
        val userId = account.username
        val filters = Specification<Task> { root, query, cb ->
            val clauses = mutableListOf(cb.or(
                cb.equal(root.get<Long>("recipientId"), account.id!!),
                cb.and(cb.equal(root.get<String>("userId"), userId), cb.isNull(root.get<Long>("recipientId")))
            ))
            if (status != null) clauses.add(cb.equal(root.get<TaskStatus>("status"), status))
            if (!search.isNullOrBlank()) {
                val literal = search.trim().lowercase().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                clauses.add(cb.like(cb.lower(root.get("title")), "%$literal%", '\\'))
            }
            if (priority != null) clauses.add(cb.equal(root.get<Priority>("priority"), priority))
            if (!category.isNullOrBlank()) clauses.add(cb.equal(root.get<String>("category"), category))
            if (query?.resultType == Task::class.java) {
                when (sort) {
                    TaskSort.NEWEST -> query.orderBy(cb.desc(root.get<Instant>("createdAt")), cb.desc(root.get<Long>("id")))
                    // Match the browser's status, focus, priority, then newest order before paging.
                    TaskSort.PRIORITY -> {
                        query.orderBy(
                            cb.asc(cb.selectCase<Int>().`when`(cb.equal(root.get<TaskStatus>("status"), TaskStatus.COMPLETED), 1).otherwise(0)),
                            cb.asc(cb.selectCase<Int>().`when`(
                                cb.and(cb.equal(root.get<LocalDate>("focusDate"), plannerToday()), cb.notEqual(root.get<TaskStatus>("status"), TaskStatus.COMPLETED)), 0).otherwise(1)),
                            cb.asc(cb.selectCase<Int>().`when`(cb.equal(root.get<Priority>("priority"), Priority.HIGH), 0)
                                .`when`(cb.equal(root.get<Priority>("priority"), Priority.MEDIUM), 1).otherwise(2)),
                            cb.desc(root.get<Instant>("createdAt")),
                            cb.desc(root.get<Long>("id")))
                    }
                }
            }
            cb.and(*clauses.toTypedArray())
        }
        val result = repo.findAll(filters, PageRequest.of(page.coerceAtLeast(0), size.coerceIn(1, 100)))
        return TaskPageResponse(result.content, result.totalElements, result.number)
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    fun create(auth: Authentication, @Valid @RequestBody body: TaskRequest): Task {
        val (owner, recipient) = lockParticipants(auth, body.recipientId)
        validateEmployeeTags(body.assigneeIds)
        val status = if (recipient != null && recipient.id != owner.id) TaskStatus.ACTIVE else body.status
        val focusDate = body.focusDate.takeIf { recipient == null || recipient.id == owner.id }
        enforceFocusLimit(owner.username, focusDate, status)
        return repo.save(
            Task(
                userId = owner.username,
                recipientId = recipient?.id,
                assignedByName = owner.displayName.takeIf { recipient != null && recipient.id != owner.id },
                title = body.title.trim(),
                notes = body.notes?.trim()?.takeIf { it.isNotEmpty() },
                dueTime = body.dueTime,
                priority = body.priority,
                category = body.category?.trim()?.takeIf { it.isNotEmpty() },
                status = status,
                focusDate = if (status == TaskStatus.COMPLETED) null else focusDate,
                assigneeIds = body.assigneeIds.toMutableList(),
                completedAt = if (status == TaskStatus.COMPLETED) Instant.now() else null
            )
        )
    }

    @PutMapping("/{id}")
    @Transactional
    fun update(auth: Authentication, @PathVariable id: Long, @Valid @RequestBody body: TaskRequest): Task {
        val (owner, recipient) = lockParticipants(auth, body.recipientId)
        validateEmployeeTags(body.assigneeIds)
        val task = repo.findByIdAndUserId(id, owner.username)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found.")
        if (task.status == TaskStatus.COMPLETED && task.recipientId != body.recipientId) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "Reopen the task before changing its recipient.")
        }
        if (task.status != body.status && (task.recipientId ?: owner.id) != owner.id) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "Only the recipient can change task status.")
        }
        val focusDate = body.focusDate.takeIf { recipient == null || recipient.id == owner.id }
        enforceFocusLimit(owner.username, focusDate, body.status, exclude = task)
        task.title = body.title.trim()
        task.notes = body.notes?.trim()?.takeIf { it.isNotEmpty() }
        task.assignedByName = when {
            recipient != null && recipient.id != owner.id -> owner.displayName
            recipient != null && task.recipientId == recipient.id -> task.assignedByName
            else -> null
        }
        task.recipientId = recipient?.id
        task.dueTime = body.dueTime
        task.priority = body.priority
        task.category = body.category?.trim()?.takeIf { it.isNotEmpty() }
        task.status = body.status
        if (body.status != TaskStatus.COMPLETED) task.completedAt = null
        else if (task.completedAt == null) task.completedAt = Instant.now()
        task.focusDate = if (body.status == TaskStatus.COMPLETED) null else focusDate
        task.assigneeIds = body.assigneeIds.toMutableList()
        task.updatedAt = Instant.now()
        return repo.save(task)
    }

    @PutMapping("/{id}/status")
    @Transactional
    fun setStatus(auth: Authentication, @PathVariable id: Long, @RequestBody body: StatusRequest): Task {
        val account = lockedUser(auth)
        val task = repo.lockById(id)
            ?.takeIf { (it.recipientId ?: users.findByUsername(it.userId)?.id) == account.id }
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found.")
        task.status = body.status
        task.completedAt = if (body.status == TaskStatus.COMPLETED) task.completedAt ?: Instant.now() else null
        if (body.status == TaskStatus.COMPLETED) task.focusDate = null
        task.updatedAt = Instant.now()
        return repo.save(task)
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    fun delete(auth: Authentication, @PathVariable id: Long) {
        val userId = lockedUser(auth).username
        val task = repo.findByIdAndUserId(id, userId)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found.")
        repo.delete(task)
    }
}

@Entity
@Table(name = "employees")
class Employee(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null,
    @field:NotBlank
    @Column(nullable = false)
    var name: String = ""
)

interface EmployeeRepository : JpaRepository<Employee, Long> {
    fun findAllByOrderByNameAsc(): List<Employee>
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select e from Employee e where e.id = :id")
    fun lockById(id: Long): Employee?
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select e from Employee e where e.id = :id")
    fun lockByIdForWrite(id: Long): Employee?
}

data class EmployeeRequest(@field:NotBlank @field:Size(max = 255) val name: String)

@RestController
@RequestMapping("/api/employees")
class EmployeeController(private val employees: EmployeeRepository) {
    @GetMapping
    fun list(): List<Employee> = employees.findAllByOrderByNameAsc()
}

@RestController
@RequestMapping("/api/admin/employees")
class AdminEmployeeController(private val employees: EmployeeRepository, private val tasks: TaskRepository) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@Valid @RequestBody body: EmployeeRequest): Employee =
        employees.save(Employee(name = body.name.trim()))

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    fun delete(@PathVariable id: Long) {
        val employee = employees.lockByIdForWrite(id)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found.")
        // shortcut: lock and scan every task on rare directory deletions; use the normalized tag table when task volume grows.
        tasks.lockAllForEmployeeCleanup().forEach { task ->
            if (task.assigneeIds.removeAll { it == id }) tasks.save(task)
        }
        employees.delete(employee)
    }
}
